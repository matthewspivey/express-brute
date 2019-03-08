class MemoryStore {
  constructor(options) {
    this.options = { prefix: '', ...options };
    this.data = {};
  }

  set(key2, value2, lifetime = 0, callback) {
    const key = this.options.prefix + key2;
    const value = JSON.stringify(value2);

    if (!this.data[key]) {
      this.data[key] = {};
    } else if (this.data[key].timeout) {
      clearTimeout(this.data[key].timeout);
    }
    this.data[key].value = value;

    if (lifetime) {
      const that = this;
      this.data[key].timeout = setTimeout(() => {
        delete that.data[key];
      }, 1000 * lifetime);
    }
    if (typeof callback === 'function') {
      callback(null);
    }
  }

  get(key2, callback) {
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
  }

  reset(key2, callback) {
    const key = this.options.prefix + key2;

    if (this.data[key] && this.data[key].timeout) {
      clearTimeout(this.data[key].timeout);
    }
    delete this.data[key];

    if (typeof callback === 'function') {
      callback(null);
    }
  }
}

module.exports = MemoryStore;
