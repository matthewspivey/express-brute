const _ = require('underscore');
const hashKey = require('./src/hashKey.js');
const { fibonacci } = require('./src/sequence.js');
const { failTooManyRequests } = require('./src/expressErrors.js');
const MemoryStore = require('./lib/MemoryStore');

function ExpressBrute(store, options) {
  ExpressBrute.instanceCount += 1;
  this.name = `brute${ExpressBrute.instanceCount}`;
  this.store = store;

  // set options
  this.options = {
    freeRetries: 2,
    proxyDepth: 0,
    attachResetToRequest: true,
    refreshTimeoutOnRequest: true,
    minWait: 500,
    maxWait: 1000 * 60 * 15, // 15 minutes
    failCallback: failTooManyRequests,
    handleStoreError(err) {
      throw {
        message: err.message,
        parent: err.parent
      };
    },
    ...options
  };

  if (this.options.minWait < 1) {
    this.options.minWait = 1;
  }

  // build array of delays in a Fibonacci sequence, such as [1,1,2,3,5]
  this.delays = fibonacci(this.options.minWait, this.options.maxWait);

  // set default lifetime
  if (!Number.isInteger(this.options.lifetime)) {
    this.options.lifetime = Math.ceil(
      (this.options.maxWait / 1000) * (this.delays.length + this.options.freeRetries)
    );
  }

  // build an Express error that we can reuse
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

function computeStuff(value, options, delays) {
  const count = value ? value.count : 0;
  const lastValidRequestTime = value ? value.lastRequest.getTime() : Date.now();
  const firstRequestTime = value ? value.firstRequest.getTime() : lastValidRequestTime;
  let delay = 0;
  if (value) {
    const delayIndex = value.count - options.freeRetries - 1;
    if (delayIndex >= 0) {
      delay = delayIndex < delays.length ? delays[delayIndex] : options.maxWait;
    }
  }
  const nextValidRequestTime = lastValidRequestTime + delay;
  let remainingLifetime = options.lifetime || 0;

  if (!options.refreshTimeoutOnRequest && remainingLifetime > 0) {
    remainingLifetime -= Math.floor((Date.now() - firstRequestTime) / 1000);
    if (remainingLifetime < 1) {
      // it should be expired alredy, treat this as a new request and reset everything
      const now = Date.now();
      return {
        count: 0,
        delay: 0,
        nextValidRequestTime: now,
        firstRequestTime: now,
        lastValidRequestTime: now,
        remainingLifetime: options.lifetime || 0
      };
    }
  }

  return { count, firstRequestTime, remainingLifetime, nextValidRequestTime };
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

            const {
              count,
              firstRequestTime,
              remainingLifetime,
              nextValidRequestTime
            } = computeStuff(value, this.options, this.delays);

            if (nextValidRequestTime <= Date.now() || count <= this.options.freeRetries) {
              // SET FUNCTION Needed below
              //
              // count
              // firstRequestTime
              // remainingLifetime
              //
              // next()
              // keyHash()
              //

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
              typeof failCallback === 'function' &&
                failCallback(req, res, next, new Date(nextValidRequestTime));
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

ExpressBrute.MemoryStore = MemoryStore;
ExpressBrute.instanceCount = 0;
module.exports = ExpressBrute;
