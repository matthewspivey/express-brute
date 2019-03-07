const _ = require('underscore');
const hashKey = require('./src/hashKey.js');
const { fibonacci } = require('./src/sequence.js');
const { failTooManyRequests } = require('./src/expressErrors.js');
const MemoryStore = require('./lib/MemoryStore');

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

function attachResetToRequest(req, store, keyHash) {
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

function computeNewTimes(value, options, getDelay, now) {
  const remainingLifetime = options.lifetime || 0;
  const count = value ? value.count : 0;
  const lastValidRequestTime = value ? value.lastRequest.getTime() : Date.now();
  const firstRequestTime = value ? value.firstRequest.getTime() : lastValidRequestTime;
  const delay = value ? getDelay(value.count) : 0;
  const nextValidRequestTime = lastValidRequestTime + delay;

  // dafuq is refreshTimeoutOnRequest
  if (options.refreshTimeoutOnRequest || remainingLifetime <= 0) {
    return { count, firstRequestTime, remainingLifetime, nextValidRequestTime };
  }

  const secondsSinceFirstRequest = Math.floor((now - firstRequestTime) / 1000);
  if (remainingLifetime > secondsSinceFirstRequest) {
    return { count, firstRequestTime, remainingLifetime, nextValidRequestTime };
  }

  // TODO - write a test to cover this one
  // it should be expired alredy, treat this as a new request and reset everything
  return {
    count: 0,
    firstRequestTime: now,
    remainingLifetime,
    nextValidRequestTime: now
  };
}

ExpressBrute.prototype.getMiddleware = function(optionsRaw) {
  // standardize input
  const options = { ...optionsRaw };
  const keyFunc =
    typeof options.key === 'function' ? options.key : (req, res, next) => next(options.key);

  const getFailCallback = _.bind(() => {
    return typeof options.failCallback === 'function'
      ? options.failCallback
      : this.options.failCallback;
  }, this);

  // create middleware
  return _.bind(function(req, res, next) {
    keyFunc(
      req,
      res,
      _.bind(key => {
        const keyHash = hashKey(options.ignoreIP ? [this.name, key] : [req.ip, this.name, key]);

        // attach a simpler "reset" function to req.brute.reset
        if (this.options.attachResetToRequest) {
          attachResetToRequest(req, this.store, keyHash);
        }

        // filter request
        this.store.get(
          keyHash,
          _.bind((err, value) => {
            if (err) {
              this.options.handleStoreError({
                req,
                res,
                next,
                message: 'Cannot get request count',
                parent: err
              });
              return;
            }

            const now = Date.now();
            const {
              count,
              firstRequestTime,
              remainingLifetime,
              nextValidRequestTime
            } = computeNewTimes(value, this.options, this.getDelay, now);

            if (nextValidRequestTime <= now || count <= this.options.freeRetries) {
              this.store.set(
                keyHash,
                {
                  count: count + 1,
                  lastRequest: Date.now(),
                  firstRequest: new Date(firstRequestTime)
                },
                remainingLifetime,
                _.bind(err2 => {
                  if (err2) {
                    this.options.handleStoreError({
                      req,
                      res,
                      next,
                      message: 'Cannot increment request count',
                      parent: err2
                    });
                    return;
                  }
                  if (typeof next === 'function') {
                    next();
                  }
                }, this)
              );
            } else {
              const failCallback = getFailCallback();
              if (typeof failCallback === 'function') {
                failCallback(req, res, next, new Date(nextValidRequestTime));
              }
            }
          }, this)
        );
      }, this)
    );
  }, this);
};

ExpressBrute.prototype.reset = function(ip, key2, callback) {
  const key = hashKey([ip, this.name, key2]);

  const xyz = err => {
    if (err) {
      this.options.handleStoreError({
        message: 'Cannot reset request count',
        parent: err,
        key,
        ip
      });
    } else if (typeof callback === 'function') {
      process.nextTick(callback);
    }
  };

  this.store.reset(key, xyz);
};

ExpressBrute.MemoryStore = MemoryStore; // TODO - this is mostly here for tests and examples
ExpressBrute.instanceCount = 0;
module.exports = ExpressBrute;
