const crypto = require('crypto');

// 'x' => 'hashofx'
const hashString = str =>
  crypto
    .createHash('sha256')
    .update(str)
    .digest('base64');

// ['x','y','z'] => 'hasedXhashedYhashedZ'
module.exports = arr =>
  arr
    .filter(part => part)
    .map(hashString)
    .join();
