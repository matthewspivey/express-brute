const crypto = require('crypto');

function hashKey(arr) {
  const key = arr
    .filter(part => part)
    .map(part =>
      crypto
        .createHash('sha256')
        .update(part)
        .digest('base64')
    )
    .join();
  return crypto
    .createHash('sha256')
    .update(key)
    .digest('base64');
}

module.exports = hashKey;
