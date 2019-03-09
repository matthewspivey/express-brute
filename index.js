const _ = require('underscore');
const hashKey = require('./src/hashKey.js');
const { fibonacci } = require('./src/sequence.js');
const { failTooManyRequests } = require('./src/expressErrors.js');
const MemoryStore = require('./lib/MemoryStore');

// TODO - depending on the value of refreshTimeoutOnRequest, we may need to only cache either the timestamp of the first or last request, not both.

function ExpressBrute(store, options = {}) {
  ExpressBrute.instanceCount += 1;
  this.name = `brute${ExpressBrute.instanceCount}`;
  this.store = store;

  // set options
  this.options = {
    freeRetries: 2,
    attachResetToRequest: true,
    refreshTimeoutOnRequest: true,
    failCallback: failTooManyRequests,
    handleStoreError(err) {
      throw new Error({
        message: err.message,
        parent: err.parent
      });
    },
    ...options
  };

  const isPositiveInteger = val => Number.isInteger(val) && val > 0;
  const minWait = isPositiveInteger(options.minWait) ? options.minWait : 500; // 500 ms
  const maxWait = isPositiveInteger(options.maxWait) ? options.maxWait : 1000 * 60 * 15; // 15 minutes

  // setup timing
  const { delays, getDelay, defaultLifetime } = fibonacci(
    minWait,
    maxWait,
    this.options.freeRetries
  );
  this.delays = delays; // TODO - remove - this is only here to make tests pass
  this.getDelay = getDelay;
  this.options.lifetime = isPositiveInteger(options.lifetime) ? options.lifetime : defaultLifetime;

  // build an Express error that we can reuse without calling the middleware
  this.prevent = this.getMiddleware();
}

function attachResetToRequestFunc(req, store, keyHash) {
  let reset = _.bind(callback => {
    store.reset(keyHash, err => {
      if (typeof callback === 'function') {
        process.nextTick(() => callback(err));
      }
    });
  }, this);
  if (req.brute && req.brute.reset) {
    // wrap existing reset if one exists
    const oldReset = req.brute.reset;
    const newReset = reset;
    reset = callback => oldReset(() => newReset(callback));
  }

  req.brute = {
    reset
  };
}

// TODO - rewrite this to make the logic more obvious
function computeNewTimes(value, refreshTimeoutOnRequest, lifetime, getDelay, now) {
  const freshValue = {
    count: 0,
    firstRequestTime: now,
    remainingLifetime: lifetime,
    nextValidRequestTime: now
  };

  // on cache miss, return values for a new counter
  if (!value) {
    return freshValue;
  }

  const { count } = value;
  const lastValidRequestTime = value.lastRequest.getTime();
  const firstRequestTime = value.firstRequest.getTime();
  const nextValidRequestTime = lastValidRequestTime + getDelay(count);

  // TODO - document
  if (refreshTimeoutOnRequest) {
    return { count, firstRequestTime, remainingLifetime: lifetime, nextValidRequestTime };
  }

  const remainingLifetime = lifetime - Math.floor((now - firstRequestTime) / 1000);

  // TODO - document the significance of remaining lifetime being zero, as well as negative
  if (remainingLifetime <= 0) {
    return { count, firstRequestTime, remainingLifetime, nextValidRequestTime };
  }

  // TODO - document the significance of this condition
  const secondsSinceFirstRequest = Math.floor((now - firstRequestTime) / 1000);
  if (remainingLifetime > secondsSinceFirstRequest) {
    return { count, firstRequestTime, remainingLifetime, nextValidRequestTime };
  }

  // TODO - document the significance of this
  // it should be expired already, treat this as a new request and reset everything
  return freshValue;
}

ExpressBrute.prototype.getMiddleware = function getMiddleware(optionsRaw = {}) {
  const { key, ignoreIP = false } = optionsRaw;
  const { handleStoreError } = this.options;

  // "can be a string or alternatively it can be a `function(req, res, next)` that calls `next`, passing a string as the first parameter."
  const keyFunc = typeof key === 'function' ? key : (req, res, next) => next(key);

  const getFailCallback = _.bind(() => {
    // use callback for this middleware
    if (typeof optionsRaw.failCallback === 'function') {
      return optionsRaw.failCallback;
    }

    // use global middleware
    if (typeof this.options.failCallback === 'function') {
      return this.options.failCallback;
    }

    // ignore failure
    return () => undefined;
  }, this);

  // create middleware
  return _.bind((req, res, next) => {
    keyFunc(
      req,
      res,
      _.bind(key2 => {
        const keyHash = hashKey(ignoreIP ? [this.name, key2] : [req.ip, this.name, key2]);

        // attach a simpler "reset" function to req.brute.reset
        if (this.options.attachResetToRequest) {
          attachResetToRequestFunc(req, this.store, keyHash);
        }

        // filter request
        this.store.get(
          keyHash,
          _.bind((getError, value) => {
            if (getError) {
              handleStoreError({
                req,
                res,
                next,
                message: 'Cannot get request count',
                parent: getError
              });
              return;
            }

            const now = Date.now();
            const {
              count,
              firstRequestTime,
              remainingLifetime,
              nextValidRequestTime
            } = computeNewTimes(
              value,
              this.options.refreshTimeoutOnRequest,
              this.options.lifetime,
              this.getDelay,
              now
            );

            if (nextValidRequestTime > now && count > this.options.freeRetries) {
              getFailCallback()(req, res, next, new Date(nextValidRequestTime));
              return;
            }

            const newValue = {
              count: count + 1,
              lastRequest: now,
              firstRequest: new Date(firstRequestTime)
            };

            this.store.set(keyHash, newValue, remainingLifetime, setError => {
              if (setError) {
                handleStoreError({
                  req,
                  res,
                  next,
                  message: 'Cannot increment request count',
                  parent: setError
                });
                return;
              }
              if (typeof next === 'function') {
                next();
              }
            });
          }, this)
        );
      }, this)
    );
  }, this);
};

ExpressBrute.prototype.reset = function(ip, key2, callback) {
  const key = hashKey([ip, this.name, key2]);

  const callbackFromStore = err => {
    if (err) {
      this.options.handleStoreError({
        message: 'Cannot reset request count',
        parent: err,
        key,
        ip
      });
    } else if (typeof callback === 'function') {
      process.nextTick(callback); // why was nextTick added?
    }
  };

  this.store.reset(key, callbackFromStore);
};

ExpressBrute.MemoryStore = MemoryStore; // TODO - this is mostly here for tests and examples
ExpressBrute.instanceCount = 0;
module.exports = ExpressBrute;
