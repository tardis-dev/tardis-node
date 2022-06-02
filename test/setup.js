var origToISOString = Date.prototype.toISOString
Date.prototype.toISOString = function () {
  const isoTimestamp = origToISOString.call(this)
  if (this.μs == undefined) {
    return isoTimestamp
  }

  return isoTimestamp.slice(0, -1) + ('' + this.μs).padStart(3, '0') + 'Z'
}
