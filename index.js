const _ = require('underscore');
const hashKey = require('./src/hashKey.js');
const { fibonacci } = require('./src/sequence.js');

function ExpressBrute(store, options) {
  ExpressBrute.instanceCount += 1;
  this.name = `brute${ExpressBrute.instanceCount}`;

  // set options
  this.options = { ...ExpressBrute.defaults, ...options };
  if (this.options.minWait < 1) {
    this.options.minWait = 1;
  }
  this.store = store;

  // build delays array
  this.delays = fibonacci(this.options.minWait, this.options.maxWait);

  // set default lifetime
  if (typeof this.options.lifetime === 'undefined') {
    this.options.lifetime =
      (this.options.maxWait / 1000) * (this.delays.length + this.options.freeRetries);
    this.options.lifetime = Math.ceil(this.options.lifetime);
  }

  // generate "prevent" middleware
  this.prevent = this.getMiddleware();
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
      _.bind(function(key) {
        if (!options.ignoreIP) {
          key = ExpressBrute._getKey([req.ip, this.name, key]);
        } else {
          key = ExpressBrute._getKey([this.name, key]);
        }

        // attach a simpler "reset" function to req.brute.reset
        if (this.options.attachResetToRequest) {
          let reset = _.bind(function(callback) {
            this.store.reset(key, function(err) {
              if (typeof callback === 'function') {
                process.nextTick(function() {
                  callback(err);
                });
              }
            });
          }, this);
          if (req.brute && req.brute.reset) {
            // wrap existing reset if one exists
            const oldReset = req.brute.reset;
            const newReset = reset;
            reset = callback =>
              oldReset(() => newReset(callback))
            };
          }
          req.brute = {
            reset
          };
        }

        // filter request
        this.store.get(
          key,
          _.bind(function(err, value) {
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

            let count = 0;
            let delay = 0;
            let lastValidRequestTime = this.now();
            let firstRequestTime = lastValidRequestTime;
            if (value) {
              count = value.count;
              lastValidRequestTime = value.lastRequest.getTime();
              firstRequestTime = value.firstRequest.getTime();

              const delayIndex = value.count - this.options.freeRetries - 1;
              if (delayIndex >= 0) {
                if (delayIndex < this.delays.length) {
                  delay = this.delays[delayIndex];
                } else {
                  delay = this.options.maxWait;
                }
              }
            }
            let nextValidRequestTime = lastValidRequestTime + delay;
            let remainingLifetime = this.options.lifetime || 0;

            if (!this.options.refreshTimeoutOnRequest && remainingLifetime > 0) {
              remainingLifetime -= Math.floor((this.now() - firstRequestTime) / 1000);
              if (remainingLifetime < 1) {
                // it should be expired alredy, treat this as a new request and reset everything
                count = 0;
                delay = 0;
                nextValidRequestTime = firstRequestTime = lastValidRequestTime = this.now();
                remainingLifetime = this.options.lifetime || 0;
              }
            }

            if (nextValidRequestTime <= this.now() || count <= this.options.freeRetries) {
              this.store.set(
                key,
                {
                  count: count + 1,
                  lastRequest: new Date(this.now()),
                  firstRequest: new Date(firstRequestTime)
                },
                remainingLifetime,
                _.bind(function(err) {
                  if (err) {
                    this.options.handleStoreError({
                      req,
                      res,
                      next,
                      message: 'Cannot increment request count',
                      parent: err
                    });
                    return;
                  }
                  typeof next === 'function' && next();
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
ExpressBrute.prototype.reset = function(ip, key, callback) {
  key = ExpressBrute._getKey([ip, this.name, key]);
  this.store.reset(
    key,
    _.bind(function(err) {
      if (err) {
        this.options.handleStoreError({
          message: 'Cannot reset request count',
          parent: err,
          key,
          ip
        });
      } else if (typeof callback === 'function') {
        process.nextTick(
          _.bind(function() {
            callback.apply(this, arguments);
          }, this)
        );
      }
    }, this)
  );
};
ExpressBrute.prototype.now = function() {
  return Date.now();
};

const setRetryAfter = function(res, nextValidRequestDate) {
  const secondUntilNextRequest = Math.ceil((nextValidRequestDate.getTime() - Date.now()) / 1000);
  res.header('Retry-After', secondUntilNextRequest);
};
ExpressBrute.FailTooManyRequests = function(req, res, next, nextValidRequestDate) {
  setRetryAfter(res, nextValidRequestDate);
  res.status(429);
  res.send({
    error: {
      text: 'Too many requests in this time frame.',
      nextValidRequestDate
    }
  });
};
ExpressBrute.FailForbidden = function(req, res, next, nextValidRequestDate) {
  setRetryAfter(res, nextValidRequestDate);
  res.status(403);
  res.send({
    error: {
      text: 'Too many requests in this time frame.',
      nextValidRequestDate
    }
  });
};
ExpressBrute.FailMark = function(req, res, next, nextValidRequestDate) {
  res.status(429);
  setRetryAfter(res, nextValidRequestDate);
  res.nextValidRequestDate = nextValidRequestDate;
  next();
};
ExpressBrute._getKey = function(arr) {
  return hashKey(arr);
};

ExpressBrute.MemoryStore = require('./lib/MemoryStore');

ExpressBrute.defaults = {
  freeRetries: 2,
  proxyDepth: 0,
  attachResetToRequest: true,
  refreshTimeoutOnRequest: true,
  minWait: 500,
  maxWait: 1000 * 60 * 15, // 15 minutes
  failCallback: ExpressBrute.FailTooManyRequests,
  handleStoreError(err) {
    throw {
      message: err.message,
      parent: err.parent
    };
  }
};
ExpressBrute.instanceCount = 0;
module.exports = ExpressBrute;
