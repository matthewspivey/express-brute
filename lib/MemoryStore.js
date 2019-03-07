const _ = require('underscore');
const longTimeout = require('long-timeout'); // not sure this is really neccessary, since it seems like node currently supports long timeouts natively

const MemoryStore = function(options) {
  this.options = { prefix: '', ...options };
  this.data = {};
};

MemoryStore.prototype.set = function(key2, value2, lifetime2, callback) {
  const key = this.options.prefix + key2;
  const lifetime = lifetime2 || 0;
  const value = JSON.stringify(value2);

  if (!this.data[key]) {
    this.data[key] = {};
  } else if (this.data[key].timeout) {
    longTimeout.clearTimeout(this.data[key].timeout);
  }
  this.data[key].value = value;

  if (lifetime) {
    this.data[key].timeout = longTimeout.setTimeout(
      _.bind(() => {
        delete this.data[key];
      }, this),
      1000 * lifetime
    );
  }
  if (typeof callback === 'function') {
    callback(null);
  }
};

MemoryStore.prototype.get = function(key2, callback) {
  const key = this.options.prefix + key2;
  let data = this.data[key] && this.data[key].value;
  if (data) {
    data = JSON.parse(data);
    data.lastRequest = new Date(data.lastRequest);
    data.firstRequest = new Date(data.firstRequest);
  }
  if (typeof callback === 'function') {
    callback(null, data);
  }
};

MemoryStore.prototype.reset = function(key2, callback) {
  const key = this.options.prefix + key2;

  if (this.data[key] && this.data[key].timeout) {
    longTimeout.clearTimeout(this.data[key].timeout);
  }
  delete this.data[key];

  if (typeof callback === 'function') {
    callback(null);
  }
};

module.exports = MemoryStore;
