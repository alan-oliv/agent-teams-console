import{createRequire}from'module';const require=createRequire(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/graceful-fs/polyfills.js
var require_polyfills = __commonJS({
  "node_modules/graceful-fs/polyfills.js"(exports, module) {
    var constants = __require("constants");
    var origCwd = process.cwd;
    var cwd = null;
    var platform = process.env.GRACEFUL_FS_PLATFORM || process.platform;
    process.cwd = function() {
      if (!cwd)
        cwd = origCwd.call(process);
      return cwd;
    };
    try {
      process.cwd();
    } catch (er) {
    }
    if (typeof process.chdir === "function") {
      chdir = process.chdir;
      process.chdir = function(d) {
        cwd = null;
        chdir.call(process, d);
      };
      if (Object.setPrototypeOf) Object.setPrototypeOf(process.chdir, chdir);
    }
    var chdir;
    module.exports = patch;
    function patch(fs9) {
      if (constants.hasOwnProperty("O_SYMLINK") && process.version.match(/^v0\.6\.[0-2]|^v0\.5\./)) {
        patchLchmod(fs9);
      }
      if (!fs9.lutimes) {
        patchLutimes(fs9);
      }
      fs9.chown = chownFix(fs9.chown);
      fs9.fchown = chownFix(fs9.fchown);
      fs9.lchown = chownFix(fs9.lchown);
      fs9.chmod = chmodFix(fs9.chmod);
      fs9.fchmod = chmodFix(fs9.fchmod);
      fs9.lchmod = chmodFix(fs9.lchmod);
      fs9.chownSync = chownFixSync(fs9.chownSync);
      fs9.fchownSync = chownFixSync(fs9.fchownSync);
      fs9.lchownSync = chownFixSync(fs9.lchownSync);
      fs9.chmodSync = chmodFixSync(fs9.chmodSync);
      fs9.fchmodSync = chmodFixSync(fs9.fchmodSync);
      fs9.lchmodSync = chmodFixSync(fs9.lchmodSync);
      fs9.stat = statFix(fs9.stat);
      fs9.fstat = statFix(fs9.fstat);
      fs9.lstat = statFix(fs9.lstat);
      fs9.statSync = statFixSync(fs9.statSync);
      fs9.fstatSync = statFixSync(fs9.fstatSync);
      fs9.lstatSync = statFixSync(fs9.lstatSync);
      if (fs9.chmod && !fs9.lchmod) {
        fs9.lchmod = function(path11, mode, cb) {
          if (cb) process.nextTick(cb);
        };
        fs9.lchmodSync = function() {
        };
      }
      if (fs9.chown && !fs9.lchown) {
        fs9.lchown = function(path11, uid, gid, cb) {
          if (cb) process.nextTick(cb);
        };
        fs9.lchownSync = function() {
        };
      }
      if (platform === "win32") {
        fs9.rename = typeof fs9.rename !== "function" ? fs9.rename : (function(fs$rename) {
          function rename(from, to, cb) {
            var start = Date.now();
            var backoff = 0;
            fs$rename(from, to, function CB(er) {
              if (er && (er.code === "EACCES" || er.code === "EPERM" || er.code === "EBUSY") && Date.now() - start < 6e4) {
                setTimeout(function() {
                  fs9.stat(to, function(stater, st) {
                    if (stater && stater.code === "ENOENT")
                      fs$rename(from, to, CB);
                    else
                      cb(er);
                  });
                }, backoff);
                if (backoff < 100)
                  backoff += 10;
                return;
              }
              if (cb) cb(er);
            });
          }
          if (Object.setPrototypeOf) Object.setPrototypeOf(rename, fs$rename);
          return rename;
        })(fs9.rename);
      }
      fs9.read = typeof fs9.read !== "function" ? fs9.read : (function(fs$read) {
        function read(fd, buffer, offset, length, position, callback_) {
          var callback;
          if (callback_ && typeof callback_ === "function") {
            var eagCounter = 0;
            callback = function(er, _, __) {
              if (er && er.code === "EAGAIN" && eagCounter < 10) {
                eagCounter++;
                return fs$read.call(fs9, fd, buffer, offset, length, position, callback);
              }
              callback_.apply(this, arguments);
            };
          }
          return fs$read.call(fs9, fd, buffer, offset, length, position, callback);
        }
        if (Object.setPrototypeOf) Object.setPrototypeOf(read, fs$read);
        return read;
      })(fs9.read);
      fs9.readSync = typeof fs9.readSync !== "function" ? fs9.readSync : /* @__PURE__ */ (function(fs$readSync) {
        return function(fd, buffer, offset, length, position) {
          var eagCounter = 0;
          while (true) {
            try {
              return fs$readSync.call(fs9, fd, buffer, offset, length, position);
            } catch (er) {
              if (er.code === "EAGAIN" && eagCounter < 10) {
                eagCounter++;
                continue;
              }
              throw er;
            }
          }
        };
      })(fs9.readSync);
      function patchLchmod(fs10) {
        fs10.lchmod = function(path11, mode, callback) {
          fs10.open(
            path11,
            constants.O_WRONLY | constants.O_SYMLINK,
            mode,
            function(err, fd) {
              if (err) {
                if (callback) callback(err);
                return;
              }
              fs10.fchmod(fd, mode, function(err2) {
                fs10.close(fd, function(err22) {
                  if (callback) callback(err2 || err22);
                });
              });
            }
          );
        };
        fs10.lchmodSync = function(path11, mode) {
          var fd = fs10.openSync(path11, constants.O_WRONLY | constants.O_SYMLINK, mode);
          var threw = true;
          var ret;
          try {
            ret = fs10.fchmodSync(fd, mode);
            threw = false;
          } finally {
            if (threw) {
              try {
                fs10.closeSync(fd);
              } catch (er) {
              }
            } else {
              fs10.closeSync(fd);
            }
          }
          return ret;
        };
      }
      function patchLutimes(fs10) {
        if (constants.hasOwnProperty("O_SYMLINK") && fs10.futimes) {
          fs10.lutimes = function(path11, at, mt, cb) {
            fs10.open(path11, constants.O_SYMLINK, function(er, fd) {
              if (er) {
                if (cb) cb(er);
                return;
              }
              fs10.futimes(fd, at, mt, function(er2) {
                fs10.close(fd, function(er22) {
                  if (cb) cb(er2 || er22);
                });
              });
            });
          };
          fs10.lutimesSync = function(path11, at, mt) {
            var fd = fs10.openSync(path11, constants.O_SYMLINK);
            var ret;
            var threw = true;
            try {
              ret = fs10.futimesSync(fd, at, mt);
              threw = false;
            } finally {
              if (threw) {
                try {
                  fs10.closeSync(fd);
                } catch (er) {
                }
              } else {
                fs10.closeSync(fd);
              }
            }
            return ret;
          };
        } else if (fs10.futimes) {
          fs10.lutimes = function(_a, _b, _c, cb) {
            if (cb) process.nextTick(cb);
          };
          fs10.lutimesSync = function() {
          };
        }
      }
      function chmodFix(orig) {
        if (!orig) return orig;
        return function(target, mode, cb) {
          return orig.call(fs9, target, mode, function(er) {
            if (chownErOk(er)) er = null;
            if (cb) cb.apply(this, arguments);
          });
        };
      }
      function chmodFixSync(orig) {
        if (!orig) return orig;
        return function(target, mode) {
          try {
            return orig.call(fs9, target, mode);
          } catch (er) {
            if (!chownErOk(er)) throw er;
          }
        };
      }
      function chownFix(orig) {
        if (!orig) return orig;
        return function(target, uid, gid, cb) {
          return orig.call(fs9, target, uid, gid, function(er) {
            if (chownErOk(er)) er = null;
            if (cb) cb.apply(this, arguments);
          });
        };
      }
      function chownFixSync(orig) {
        if (!orig) return orig;
        return function(target, uid, gid) {
          try {
            return orig.call(fs9, target, uid, gid);
          } catch (er) {
            if (!chownErOk(er)) throw er;
          }
        };
      }
      function statFix(orig) {
        if (!orig) return orig;
        return function(target, options, cb) {
          if (typeof options === "function") {
            cb = options;
            options = null;
          }
          function callback(er, stats) {
            if (stats) {
              if (stats.uid < 0) stats.uid += 4294967296;
              if (stats.gid < 0) stats.gid += 4294967296;
            }
            if (cb) cb.apply(this, arguments);
          }
          return options ? orig.call(fs9, target, options, callback) : orig.call(fs9, target, callback);
        };
      }
      function statFixSync(orig) {
        if (!orig) return orig;
        return function(target, options) {
          var stats = options ? orig.call(fs9, target, options) : orig.call(fs9, target);
          if (stats) {
            if (stats.uid < 0) stats.uid += 4294967296;
            if (stats.gid < 0) stats.gid += 4294967296;
          }
          return stats;
        };
      }
      function chownErOk(er) {
        if (!er)
          return true;
        if (er.code === "ENOSYS")
          return true;
        var nonroot = !process.getuid || process.getuid() !== 0;
        if (nonroot) {
          if (er.code === "EINVAL" || er.code === "EPERM")
            return true;
        }
        return false;
      }
    }
  }
});

// node_modules/graceful-fs/legacy-streams.js
var require_legacy_streams = __commonJS({
  "node_modules/graceful-fs/legacy-streams.js"(exports, module) {
    var Stream = __require("stream").Stream;
    module.exports = legacy;
    function legacy(fs9) {
      return {
        ReadStream,
        WriteStream
      };
      function ReadStream(path11, options) {
        if (!(this instanceof ReadStream)) return new ReadStream(path11, options);
        Stream.call(this);
        var self = this;
        this.path = path11;
        this.fd = null;
        this.readable = true;
        this.paused = false;
        this.flags = "r";
        this.mode = 438;
        this.bufferSize = 64 * 1024;
        options = options || {};
        var keys = Object.keys(options);
        for (var index = 0, length = keys.length; index < length; index++) {
          var key = keys[index];
          this[key] = options[key];
        }
        if (this.encoding) this.setEncoding(this.encoding);
        if (this.start !== void 0) {
          if ("number" !== typeof this.start) {
            throw TypeError("start must be a Number");
          }
          if (this.end === void 0) {
            this.end = Infinity;
          } else if ("number" !== typeof this.end) {
            throw TypeError("end must be a Number");
          }
          if (this.start > this.end) {
            throw new Error("start must be <= end");
          }
          this.pos = this.start;
        }
        if (this.fd !== null) {
          process.nextTick(function() {
            self._read();
          });
          return;
        }
        fs9.open(this.path, this.flags, this.mode, function(err, fd) {
          if (err) {
            self.emit("error", err);
            self.readable = false;
            return;
          }
          self.fd = fd;
          self.emit("open", fd);
          self._read();
        });
      }
      function WriteStream(path11, options) {
        if (!(this instanceof WriteStream)) return new WriteStream(path11, options);
        Stream.call(this);
        this.path = path11;
        this.fd = null;
        this.writable = true;
        this.flags = "w";
        this.encoding = "binary";
        this.mode = 438;
        this.bytesWritten = 0;
        options = options || {};
        var keys = Object.keys(options);
        for (var index = 0, length = keys.length; index < length; index++) {
          var key = keys[index];
          this[key] = options[key];
        }
        if (this.start !== void 0) {
          if ("number" !== typeof this.start) {
            throw TypeError("start must be a Number");
          }
          if (this.start < 0) {
            throw new Error("start must be >= zero");
          }
          this.pos = this.start;
        }
        this.busy = false;
        this._queue = [];
        if (this.fd === null) {
          this._open = fs9.open;
          this._queue.push([this._open, this.path, this.flags, this.mode, void 0]);
          this.flush();
        }
      }
    }
  }
});

// node_modules/graceful-fs/clone.js
var require_clone = __commonJS({
  "node_modules/graceful-fs/clone.js"(exports, module) {
    "use strict";
    module.exports = clone;
    var getPrototypeOf = Object.getPrototypeOf || function(obj) {
      return obj.__proto__;
    };
    function clone(obj) {
      if (obj === null || typeof obj !== "object")
        return obj;
      if (obj instanceof Object)
        var copy = { __proto__: getPrototypeOf(obj) };
      else
        var copy = /* @__PURE__ */ Object.create(null);
      Object.getOwnPropertyNames(obj).forEach(function(key) {
        Object.defineProperty(copy, key, Object.getOwnPropertyDescriptor(obj, key));
      });
      return copy;
    }
  }
});

// node_modules/graceful-fs/graceful-fs.js
var require_graceful_fs = __commonJS({
  "node_modules/graceful-fs/graceful-fs.js"(exports, module) {
    var fs9 = __require("fs");
    var polyfills = require_polyfills();
    var legacy = require_legacy_streams();
    var clone = require_clone();
    var util = __require("util");
    var gracefulQueue;
    var previousSymbol;
    if (typeof Symbol === "function" && typeof Symbol.for === "function") {
      gracefulQueue = /* @__PURE__ */ Symbol.for("graceful-fs.queue");
      previousSymbol = /* @__PURE__ */ Symbol.for("graceful-fs.previous");
    } else {
      gracefulQueue = "___graceful-fs.queue";
      previousSymbol = "___graceful-fs.previous";
    }
    function noop() {
    }
    function publishQueue(context, queue2) {
      Object.defineProperty(context, gracefulQueue, {
        get: function() {
          return queue2;
        }
      });
    }
    var debug2 = noop;
    if (util.debuglog)
      debug2 = util.debuglog("gfs4");
    else if (/\bgfs4\b/i.test(process.env.NODE_DEBUG || ""))
      debug2 = function() {
        var m = util.format.apply(util, arguments);
        m = "GFS4: " + m.split(/\n/).join("\nGFS4: ");
        console.error(m);
      };
    if (!fs9[gracefulQueue]) {
      queue = global[gracefulQueue] || [];
      publishQueue(fs9, queue);
      fs9.close = (function(fs$close) {
        function close(fd, cb) {
          return fs$close.call(fs9, fd, function(err) {
            if (!err) {
              resetQueue();
            }
            if (typeof cb === "function")
              cb.apply(this, arguments);
          });
        }
        Object.defineProperty(close, previousSymbol, {
          value: fs$close
        });
        return close;
      })(fs9.close);
      fs9.closeSync = (function(fs$closeSync) {
        function closeSync(fd) {
          fs$closeSync.apply(fs9, arguments);
          resetQueue();
        }
        Object.defineProperty(closeSync, previousSymbol, {
          value: fs$closeSync
        });
        return closeSync;
      })(fs9.closeSync);
      if (/\bgfs4\b/i.test(process.env.NODE_DEBUG || "")) {
        process.on("exit", function() {
          debug2(fs9[gracefulQueue]);
          __require("assert").equal(fs9[gracefulQueue].length, 0);
        });
      }
    }
    var queue;
    if (!global[gracefulQueue]) {
      publishQueue(global, fs9[gracefulQueue]);
    }
    module.exports = patch(clone(fs9));
    if (process.env.TEST_GRACEFUL_FS_GLOBAL_PATCH && !fs9.__patched) {
      module.exports = patch(fs9);
      fs9.__patched = true;
    }
    function patch(fs10) {
      polyfills(fs10);
      fs10.gracefulify = patch;
      fs10.createReadStream = createReadStream;
      fs10.createWriteStream = createWriteStream;
      var fs$readFile = fs10.readFile;
      fs10.readFile = readFile;
      function readFile(path11, options, cb) {
        if (typeof options === "function")
          cb = options, options = null;
        return go$readFile(path11, options, cb);
        function go$readFile(path12, options2, cb2, startTime) {
          return fs$readFile(path12, options2, function(err) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([go$readFile, [path12, options2, cb2], err, startTime || Date.now(), Date.now()]);
            else {
              if (typeof cb2 === "function")
                cb2.apply(this, arguments);
            }
          });
        }
      }
      var fs$writeFile = fs10.writeFile;
      fs10.writeFile = writeFile;
      function writeFile(path11, data, options, cb) {
        if (typeof options === "function")
          cb = options, options = null;
        return go$writeFile(path11, data, options, cb);
        function go$writeFile(path12, data2, options2, cb2, startTime) {
          return fs$writeFile(path12, data2, options2, function(err) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([go$writeFile, [path12, data2, options2, cb2], err, startTime || Date.now(), Date.now()]);
            else {
              if (typeof cb2 === "function")
                cb2.apply(this, arguments);
            }
          });
        }
      }
      var fs$appendFile = fs10.appendFile;
      if (fs$appendFile)
        fs10.appendFile = appendFile;
      function appendFile(path11, data, options, cb) {
        if (typeof options === "function")
          cb = options, options = null;
        return go$appendFile(path11, data, options, cb);
        function go$appendFile(path12, data2, options2, cb2, startTime) {
          return fs$appendFile(path12, data2, options2, function(err) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([go$appendFile, [path12, data2, options2, cb2], err, startTime || Date.now(), Date.now()]);
            else {
              if (typeof cb2 === "function")
                cb2.apply(this, arguments);
            }
          });
        }
      }
      var fs$copyFile = fs10.copyFile;
      if (fs$copyFile)
        fs10.copyFile = copyFile;
      function copyFile(src, dest, flags, cb) {
        if (typeof flags === "function") {
          cb = flags;
          flags = 0;
        }
        return go$copyFile(src, dest, flags, cb);
        function go$copyFile(src2, dest2, flags2, cb2, startTime) {
          return fs$copyFile(src2, dest2, flags2, function(err) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([go$copyFile, [src2, dest2, flags2, cb2], err, startTime || Date.now(), Date.now()]);
            else {
              if (typeof cb2 === "function")
                cb2.apply(this, arguments);
            }
          });
        }
      }
      var fs$readdir = fs10.readdir;
      fs10.readdir = readdir;
      var noReaddirOptionVersions = /^v[0-5]\./;
      function readdir(path11, options, cb) {
        if (typeof options === "function")
          cb = options, options = null;
        var go$readdir = noReaddirOptionVersions.test(process.version) ? function go$readdir2(path12, options2, cb2, startTime) {
          return fs$readdir(path12, fs$readdirCallback(
            path12,
            options2,
            cb2,
            startTime
          ));
        } : function go$readdir2(path12, options2, cb2, startTime) {
          return fs$readdir(path12, options2, fs$readdirCallback(
            path12,
            options2,
            cb2,
            startTime
          ));
        };
        return go$readdir(path11, options, cb);
        function fs$readdirCallback(path12, options2, cb2, startTime) {
          return function(err, files) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([
                go$readdir,
                [path12, options2, cb2],
                err,
                startTime || Date.now(),
                Date.now()
              ]);
            else {
              if (files && files.sort)
                files.sort();
              if (typeof cb2 === "function")
                cb2.call(this, err, files);
            }
          };
        }
      }
      if (process.version.substr(0, 4) === "v0.8") {
        var legStreams = legacy(fs10);
        ReadStream = legStreams.ReadStream;
        WriteStream = legStreams.WriteStream;
      }
      var fs$ReadStream = fs10.ReadStream;
      if (fs$ReadStream) {
        ReadStream.prototype = Object.create(fs$ReadStream.prototype);
        ReadStream.prototype.open = ReadStream$open;
      }
      var fs$WriteStream = fs10.WriteStream;
      if (fs$WriteStream) {
        WriteStream.prototype = Object.create(fs$WriteStream.prototype);
        WriteStream.prototype.open = WriteStream$open;
      }
      Object.defineProperty(fs10, "ReadStream", {
        get: function() {
          return ReadStream;
        },
        set: function(val) {
          ReadStream = val;
        },
        enumerable: true,
        configurable: true
      });
      Object.defineProperty(fs10, "WriteStream", {
        get: function() {
          return WriteStream;
        },
        set: function(val) {
          WriteStream = val;
        },
        enumerable: true,
        configurable: true
      });
      var FileReadStream = ReadStream;
      Object.defineProperty(fs10, "FileReadStream", {
        get: function() {
          return FileReadStream;
        },
        set: function(val) {
          FileReadStream = val;
        },
        enumerable: true,
        configurable: true
      });
      var FileWriteStream = WriteStream;
      Object.defineProperty(fs10, "FileWriteStream", {
        get: function() {
          return FileWriteStream;
        },
        set: function(val) {
          FileWriteStream = val;
        },
        enumerable: true,
        configurable: true
      });
      function ReadStream(path11, options) {
        if (this instanceof ReadStream)
          return fs$ReadStream.apply(this, arguments), this;
        else
          return ReadStream.apply(Object.create(ReadStream.prototype), arguments);
      }
      function ReadStream$open() {
        var that = this;
        open(that.path, that.flags, that.mode, function(err, fd) {
          if (err) {
            if (that.autoClose)
              that.destroy();
            that.emit("error", err);
          } else {
            that.fd = fd;
            that.emit("open", fd);
            that.read();
          }
        });
      }
      function WriteStream(path11, options) {
        if (this instanceof WriteStream)
          return fs$WriteStream.apply(this, arguments), this;
        else
          return WriteStream.apply(Object.create(WriteStream.prototype), arguments);
      }
      function WriteStream$open() {
        var that = this;
        open(that.path, that.flags, that.mode, function(err, fd) {
          if (err) {
            that.destroy();
            that.emit("error", err);
          } else {
            that.fd = fd;
            that.emit("open", fd);
          }
        });
      }
      function createReadStream(path11, options) {
        return new fs10.ReadStream(path11, options);
      }
      function createWriteStream(path11, options) {
        return new fs10.WriteStream(path11, options);
      }
      var fs$open = fs10.open;
      fs10.open = open;
      function open(path11, flags, mode, cb) {
        if (typeof mode === "function")
          cb = mode, mode = null;
        return go$open(path11, flags, mode, cb);
        function go$open(path12, flags2, mode2, cb2, startTime) {
          return fs$open(path12, flags2, mode2, function(err, fd) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([go$open, [path12, flags2, mode2, cb2], err, startTime || Date.now(), Date.now()]);
            else {
              if (typeof cb2 === "function")
                cb2.apply(this, arguments);
            }
          });
        }
      }
      return fs10;
    }
    function enqueue(elem) {
      debug2("ENQUEUE", elem[0].name, elem[1]);
      fs9[gracefulQueue].push(elem);
      retry();
    }
    var retryTimer;
    function resetQueue() {
      var now = Date.now();
      for (var i = 0; i < fs9[gracefulQueue].length; ++i) {
        if (fs9[gracefulQueue][i].length > 2) {
          fs9[gracefulQueue][i][3] = now;
          fs9[gracefulQueue][i][4] = now;
        }
      }
      retry();
    }
    function retry() {
      clearTimeout(retryTimer);
      retryTimer = void 0;
      if (fs9[gracefulQueue].length === 0)
        return;
      var elem = fs9[gracefulQueue].shift();
      var fn = elem[0];
      var args = elem[1];
      var err = elem[2];
      var startTime = elem[3];
      var lastTime = elem[4];
      if (startTime === void 0) {
        debug2("RETRY", fn.name, args);
        fn.apply(null, args);
      } else if (Date.now() - startTime >= 6e4) {
        debug2("TIMEOUT", fn.name, args);
        var cb = args.pop();
        if (typeof cb === "function")
          cb.call(null, err);
      } else {
        var sinceAttempt = Date.now() - lastTime;
        var sinceStart = Math.max(lastTime - startTime, 1);
        var desiredDelay = Math.min(sinceStart * 1.2, 100);
        if (sinceAttempt >= desiredDelay) {
          debug2("RETRY", fn.name, args);
          fn.apply(null, args.concat([startTime]));
        } else {
          fs9[gracefulQueue].push(elem);
        }
      }
      if (retryTimer === void 0) {
        retryTimer = setTimeout(retry, 0);
      }
    }
  }
});

// node_modules/retry/lib/retry_operation.js
var require_retry_operation = __commonJS({
  "node_modules/retry/lib/retry_operation.js"(exports, module) {
    function RetryOperation(timeouts, options) {
      if (typeof options === "boolean") {
        options = { forever: options };
      }
      this._originalTimeouts = JSON.parse(JSON.stringify(timeouts));
      this._timeouts = timeouts;
      this._options = options || {};
      this._maxRetryTime = options && options.maxRetryTime || Infinity;
      this._fn = null;
      this._errors = [];
      this._attempts = 1;
      this._operationTimeout = null;
      this._operationTimeoutCb = null;
      this._timeout = null;
      this._operationStart = null;
      if (this._options.forever) {
        this._cachedTimeouts = this._timeouts.slice(0);
      }
    }
    module.exports = RetryOperation;
    RetryOperation.prototype.reset = function() {
      this._attempts = 1;
      this._timeouts = this._originalTimeouts;
    };
    RetryOperation.prototype.stop = function() {
      if (this._timeout) {
        clearTimeout(this._timeout);
      }
      this._timeouts = [];
      this._cachedTimeouts = null;
    };
    RetryOperation.prototype.retry = function(err) {
      if (this._timeout) {
        clearTimeout(this._timeout);
      }
      if (!err) {
        return false;
      }
      var currentTime = (/* @__PURE__ */ new Date()).getTime();
      if (err && currentTime - this._operationStart >= this._maxRetryTime) {
        this._errors.unshift(new Error("RetryOperation timeout occurred"));
        return false;
      }
      this._errors.push(err);
      var timeout = this._timeouts.shift();
      if (timeout === void 0) {
        if (this._cachedTimeouts) {
          this._errors.splice(this._errors.length - 1, this._errors.length);
          this._timeouts = this._cachedTimeouts.slice(0);
          timeout = this._timeouts.shift();
        } else {
          return false;
        }
      }
      var self = this;
      var timer = setTimeout(function() {
        self._attempts++;
        if (self._operationTimeoutCb) {
          self._timeout = setTimeout(function() {
            self._operationTimeoutCb(self._attempts);
          }, self._operationTimeout);
          if (self._options.unref) {
            self._timeout.unref();
          }
        }
        self._fn(self._attempts);
      }, timeout);
      if (this._options.unref) {
        timer.unref();
      }
      return true;
    };
    RetryOperation.prototype.attempt = function(fn, timeoutOps) {
      this._fn = fn;
      if (timeoutOps) {
        if (timeoutOps.timeout) {
          this._operationTimeout = timeoutOps.timeout;
        }
        if (timeoutOps.cb) {
          this._operationTimeoutCb = timeoutOps.cb;
        }
      }
      var self = this;
      if (this._operationTimeoutCb) {
        this._timeout = setTimeout(function() {
          self._operationTimeoutCb();
        }, self._operationTimeout);
      }
      this._operationStart = (/* @__PURE__ */ new Date()).getTime();
      this._fn(this._attempts);
    };
    RetryOperation.prototype.try = function(fn) {
      console.log("Using RetryOperation.try() is deprecated");
      this.attempt(fn);
    };
    RetryOperation.prototype.start = function(fn) {
      console.log("Using RetryOperation.start() is deprecated");
      this.attempt(fn);
    };
    RetryOperation.prototype.start = RetryOperation.prototype.try;
    RetryOperation.prototype.errors = function() {
      return this._errors;
    };
    RetryOperation.prototype.attempts = function() {
      return this._attempts;
    };
    RetryOperation.prototype.mainError = function() {
      if (this._errors.length === 0) {
        return null;
      }
      var counts = {};
      var mainError = null;
      var mainErrorCount = 0;
      for (var i = 0; i < this._errors.length; i++) {
        var error = this._errors[i];
        var message = error.message;
        var count = (counts[message] || 0) + 1;
        counts[message] = count;
        if (count >= mainErrorCount) {
          mainError = error;
          mainErrorCount = count;
        }
      }
      return mainError;
    };
  }
});

// node_modules/retry/lib/retry.js
var require_retry = __commonJS({
  "node_modules/retry/lib/retry.js"(exports) {
    var RetryOperation = require_retry_operation();
    exports.operation = function(options) {
      var timeouts = exports.timeouts(options);
      return new RetryOperation(timeouts, {
        forever: options && options.forever,
        unref: options && options.unref,
        maxRetryTime: options && options.maxRetryTime
      });
    };
    exports.timeouts = function(options) {
      if (options instanceof Array) {
        return [].concat(options);
      }
      var opts = {
        retries: 10,
        factor: 2,
        minTimeout: 1 * 1e3,
        maxTimeout: Infinity,
        randomize: false
      };
      for (var key in options) {
        opts[key] = options[key];
      }
      if (opts.minTimeout > opts.maxTimeout) {
        throw new Error("minTimeout is greater than maxTimeout");
      }
      var timeouts = [];
      for (var i = 0; i < opts.retries; i++) {
        timeouts.push(this.createTimeout(i, opts));
      }
      if (options && options.forever && !timeouts.length) {
        timeouts.push(this.createTimeout(i, opts));
      }
      timeouts.sort(function(a, b) {
        return a - b;
      });
      return timeouts;
    };
    exports.createTimeout = function(attempt, opts) {
      var random = opts.randomize ? Math.random() + 1 : 1;
      var timeout = Math.round(random * opts.minTimeout * Math.pow(opts.factor, attempt));
      timeout = Math.min(timeout, opts.maxTimeout);
      return timeout;
    };
    exports.wrap = function(obj, options, methods) {
      if (options instanceof Array) {
        methods = options;
        options = null;
      }
      if (!methods) {
        methods = [];
        for (var key in obj) {
          if (typeof obj[key] === "function") {
            methods.push(key);
          }
        }
      }
      for (var i = 0; i < methods.length; i++) {
        var method = methods[i];
        var original = obj[method];
        obj[method] = function retryWrapper(original2) {
          var op = exports.operation(options);
          var args = Array.prototype.slice.call(arguments, 1);
          var callback = args.pop();
          args.push(function(err) {
            if (op.retry(err)) {
              return;
            }
            if (err) {
              arguments[0] = op.mainError();
            }
            callback.apply(this, arguments);
          });
          op.attempt(function() {
            original2.apply(obj, args);
          });
        }.bind(obj, original);
        obj[method].options = options;
      }
    };
  }
});

// node_modules/retry/index.js
var require_retry2 = __commonJS({
  "node_modules/retry/index.js"(exports, module) {
    module.exports = require_retry();
  }
});

// node_modules/signal-exit/signals.js
var require_signals = __commonJS({
  "node_modules/signal-exit/signals.js"(exports, module) {
    module.exports = [
      "SIGABRT",
      "SIGALRM",
      "SIGHUP",
      "SIGINT",
      "SIGTERM"
    ];
    if (process.platform !== "win32") {
      module.exports.push(
        "SIGVTALRM",
        "SIGXCPU",
        "SIGXFSZ",
        "SIGUSR2",
        "SIGTRAP",
        "SIGSYS",
        "SIGQUIT",
        "SIGIOT"
        // should detect profiler and enable/disable accordingly.
        // see #21
        // 'SIGPROF'
      );
    }
    if (process.platform === "linux") {
      module.exports.push(
        "SIGIO",
        "SIGPOLL",
        "SIGPWR",
        "SIGSTKFLT",
        "SIGUNUSED"
      );
    }
  }
});

// node_modules/signal-exit/index.js
var require_signal_exit = __commonJS({
  "node_modules/signal-exit/index.js"(exports, module) {
    var process2 = global.process;
    var processOk = function(process3) {
      return process3 && typeof process3 === "object" && typeof process3.removeListener === "function" && typeof process3.emit === "function" && typeof process3.reallyExit === "function" && typeof process3.listeners === "function" && typeof process3.kill === "function" && typeof process3.pid === "number" && typeof process3.on === "function";
    };
    if (!processOk(process2)) {
      module.exports = function() {
        return function() {
        };
      };
    } else {
      assert = __require("assert");
      signals = require_signals();
      isWin = /^win/i.test(process2.platform);
      EE = __require("events");
      if (typeof EE !== "function") {
        EE = EE.EventEmitter;
      }
      if (process2.__signal_exit_emitter__) {
        emitter = process2.__signal_exit_emitter__;
      } else {
        emitter = process2.__signal_exit_emitter__ = new EE();
        emitter.count = 0;
        emitter.emitted = {};
      }
      if (!emitter.infinite) {
        emitter.setMaxListeners(Infinity);
        emitter.infinite = true;
      }
      module.exports = function(cb, opts) {
        if (!processOk(global.process)) {
          return function() {
          };
        }
        assert.equal(typeof cb, "function", "a callback must be provided for exit handler");
        if (loaded === false) {
          load();
        }
        var ev = "exit";
        if (opts && opts.alwaysLast) {
          ev = "afterexit";
        }
        var remove = function() {
          emitter.removeListener(ev, cb);
          if (emitter.listeners("exit").length === 0 && emitter.listeners("afterexit").length === 0) {
            unload();
          }
        };
        emitter.on(ev, cb);
        return remove;
      };
      unload = function unload2() {
        if (!loaded || !processOk(global.process)) {
          return;
        }
        loaded = false;
        signals.forEach(function(sig) {
          try {
            process2.removeListener(sig, sigListeners[sig]);
          } catch (er) {
          }
        });
        process2.emit = originalProcessEmit;
        process2.reallyExit = originalProcessReallyExit;
        emitter.count -= 1;
      };
      module.exports.unload = unload;
      emit = function emit2(event, code, signal) {
        if (emitter.emitted[event]) {
          return;
        }
        emitter.emitted[event] = true;
        emitter.emit(event, code, signal);
      };
      sigListeners = {};
      signals.forEach(function(sig) {
        sigListeners[sig] = function listener() {
          if (!processOk(global.process)) {
            return;
          }
          var listeners = process2.listeners(sig);
          if (listeners.length === emitter.count) {
            unload();
            emit("exit", null, sig);
            emit("afterexit", null, sig);
            if (isWin && sig === "SIGHUP") {
              sig = "SIGINT";
            }
            process2.kill(process2.pid, sig);
          }
        };
      });
      module.exports.signals = function() {
        return signals;
      };
      loaded = false;
      load = function load2() {
        if (loaded || !processOk(global.process)) {
          return;
        }
        loaded = true;
        emitter.count += 1;
        signals = signals.filter(function(sig) {
          try {
            process2.on(sig, sigListeners[sig]);
            return true;
          } catch (er) {
            return false;
          }
        });
        process2.emit = processEmit;
        process2.reallyExit = processReallyExit;
      };
      module.exports.load = load;
      originalProcessReallyExit = process2.reallyExit;
      processReallyExit = function processReallyExit2(code) {
        if (!processOk(global.process)) {
          return;
        }
        process2.exitCode = code || /* istanbul ignore next */
        0;
        emit("exit", process2.exitCode, null);
        emit("afterexit", process2.exitCode, null);
        originalProcessReallyExit.call(process2, process2.exitCode);
      };
      originalProcessEmit = process2.emit;
      processEmit = function processEmit2(ev, arg) {
        if (ev === "exit" && processOk(global.process)) {
          if (arg !== void 0) {
            process2.exitCode = arg;
          }
          var ret = originalProcessEmit.apply(this, arguments);
          emit("exit", process2.exitCode, null);
          emit("afterexit", process2.exitCode, null);
          return ret;
        } else {
          return originalProcessEmit.apply(this, arguments);
        }
      };
    }
    var assert;
    var signals;
    var isWin;
    var EE;
    var emitter;
    var unload;
    var emit;
    var sigListeners;
    var loaded;
    var load;
    var originalProcessReallyExit;
    var processReallyExit;
    var originalProcessEmit;
    var processEmit;
  }
});

// node_modules/proper-lockfile/lib/mtime-precision.js
var require_mtime_precision = __commonJS({
  "node_modules/proper-lockfile/lib/mtime-precision.js"(exports, module) {
    "use strict";
    var cacheSymbol = /* @__PURE__ */ Symbol();
    function probe(file, fs9, callback) {
      const cachedPrecision = fs9[cacheSymbol];
      if (cachedPrecision) {
        return fs9.stat(file, (err, stat) => {
          if (err) {
            return callback(err);
          }
          callback(null, stat.mtime, cachedPrecision);
        });
      }
      const mtime = new Date(Math.ceil(Date.now() / 1e3) * 1e3 + 5);
      fs9.utimes(file, mtime, mtime, (err) => {
        if (err) {
          return callback(err);
        }
        fs9.stat(file, (err2, stat) => {
          if (err2) {
            return callback(err2);
          }
          const precision = stat.mtime.getTime() % 1e3 === 0 ? "s" : "ms";
          Object.defineProperty(fs9, cacheSymbol, { value: precision });
          callback(null, stat.mtime, precision);
        });
      });
    }
    function getMtime(precision) {
      let now = Date.now();
      if (precision === "s") {
        now = Math.ceil(now / 1e3) * 1e3;
      }
      return new Date(now);
    }
    module.exports.probe = probe;
    module.exports.getMtime = getMtime;
  }
});

// node_modules/proper-lockfile/lib/lockfile.js
var require_lockfile = __commonJS({
  "node_modules/proper-lockfile/lib/lockfile.js"(exports, module) {
    "use strict";
    var path11 = __require("path");
    var fs9 = require_graceful_fs();
    var retry = require_retry2();
    var onExit = require_signal_exit();
    var mtimePrecision = require_mtime_precision();
    var locks = {};
    function getLockFile(file, options) {
      return options.lockfilePath || `${file}.lock`;
    }
    function resolveCanonicalPath(file, options, callback) {
      if (!options.realpath) {
        return callback(null, path11.resolve(file));
      }
      options.fs.realpath(file, callback);
    }
    function acquireLock(file, options, callback) {
      const lockfilePath = getLockFile(file, options);
      options.fs.mkdir(lockfilePath, (err) => {
        if (!err) {
          return mtimePrecision.probe(lockfilePath, options.fs, (err2, mtime, mtimePrecision2) => {
            if (err2) {
              options.fs.rmdir(lockfilePath, () => {
              });
              return callback(err2);
            }
            callback(null, mtime, mtimePrecision2);
          });
        }
        if (err.code !== "EEXIST") {
          return callback(err);
        }
        if (options.stale <= 0) {
          return callback(Object.assign(new Error("Lock file is already being held"), { code: "ELOCKED", file }));
        }
        options.fs.stat(lockfilePath, (err2, stat) => {
          if (err2) {
            if (err2.code === "ENOENT") {
              return acquireLock(file, { ...options, stale: 0 }, callback);
            }
            return callback(err2);
          }
          if (!isLockStale(stat, options)) {
            return callback(Object.assign(new Error("Lock file is already being held"), { code: "ELOCKED", file }));
          }
          removeLock(file, options, (err3) => {
            if (err3) {
              return callback(err3);
            }
            acquireLock(file, { ...options, stale: 0 }, callback);
          });
        });
      });
    }
    function isLockStale(stat, options) {
      return stat.mtime.getTime() < Date.now() - options.stale;
    }
    function removeLock(file, options, callback) {
      options.fs.rmdir(getLockFile(file, options), (err) => {
        if (err && err.code !== "ENOENT") {
          return callback(err);
        }
        callback();
      });
    }
    function updateLock(file, options) {
      const lock2 = locks[file];
      if (lock2.updateTimeout) {
        return;
      }
      lock2.updateDelay = lock2.updateDelay || options.update;
      lock2.updateTimeout = setTimeout(() => {
        lock2.updateTimeout = null;
        options.fs.stat(lock2.lockfilePath, (err, stat) => {
          const isOverThreshold = lock2.lastUpdate + options.stale < Date.now();
          if (err) {
            if (err.code === "ENOENT" || isOverThreshold) {
              return setLockAsCompromised(file, lock2, Object.assign(err, { code: "ECOMPROMISED" }));
            }
            lock2.updateDelay = 1e3;
            return updateLock(file, options);
          }
          const isMtimeOurs = lock2.mtime.getTime() === stat.mtime.getTime();
          if (!isMtimeOurs) {
            return setLockAsCompromised(
              file,
              lock2,
              Object.assign(
                new Error("Unable to update lock within the stale threshold"),
                { code: "ECOMPROMISED" }
              )
            );
          }
          const mtime = mtimePrecision.getMtime(lock2.mtimePrecision);
          options.fs.utimes(lock2.lockfilePath, mtime, mtime, (err2) => {
            const isOverThreshold2 = lock2.lastUpdate + options.stale < Date.now();
            if (lock2.released) {
              return;
            }
            if (err2) {
              if (err2.code === "ENOENT" || isOverThreshold2) {
                return setLockAsCompromised(file, lock2, Object.assign(err2, { code: "ECOMPROMISED" }));
              }
              lock2.updateDelay = 1e3;
              return updateLock(file, options);
            }
            lock2.mtime = mtime;
            lock2.lastUpdate = Date.now();
            lock2.updateDelay = null;
            updateLock(file, options);
          });
        });
      }, lock2.updateDelay);
      if (lock2.updateTimeout.unref) {
        lock2.updateTimeout.unref();
      }
    }
    function setLockAsCompromised(file, lock2, err) {
      lock2.released = true;
      if (lock2.updateTimeout) {
        clearTimeout(lock2.updateTimeout);
      }
      if (locks[file] === lock2) {
        delete locks[file];
      }
      lock2.options.onCompromised(err);
    }
    function lock(file, options, callback) {
      options = {
        stale: 1e4,
        update: null,
        realpath: true,
        retries: 0,
        fs: fs9,
        onCompromised: (err) => {
          throw err;
        },
        ...options
      };
      options.retries = options.retries || 0;
      options.retries = typeof options.retries === "number" ? { retries: options.retries } : options.retries;
      options.stale = Math.max(options.stale || 0, 2e3);
      options.update = options.update == null ? options.stale / 2 : options.update || 0;
      options.update = Math.max(Math.min(options.update, options.stale / 2), 1e3);
      resolveCanonicalPath(file, options, (err, file2) => {
        if (err) {
          return callback(err);
        }
        const operation = retry.operation(options.retries);
        operation.attempt(() => {
          acquireLock(file2, options, (err2, mtime, mtimePrecision2) => {
            if (operation.retry(err2)) {
              return;
            }
            if (err2) {
              return callback(operation.mainError());
            }
            const lock2 = locks[file2] = {
              lockfilePath: getLockFile(file2, options),
              mtime,
              mtimePrecision: mtimePrecision2,
              options,
              lastUpdate: Date.now()
            };
            updateLock(file2, options);
            callback(null, (releasedCallback) => {
              if (lock2.released) {
                return releasedCallback && releasedCallback(Object.assign(new Error("Lock is already released"), { code: "ERELEASED" }));
              }
              unlock(file2, { ...options, realpath: false }, releasedCallback);
            });
          });
        });
      });
    }
    function unlock(file, options, callback) {
      options = {
        fs: fs9,
        realpath: true,
        ...options
      };
      resolveCanonicalPath(file, options, (err, file2) => {
        if (err) {
          return callback(err);
        }
        const lock2 = locks[file2];
        if (!lock2) {
          return callback(Object.assign(new Error("Lock is not acquired/owned by you"), { code: "ENOTACQUIRED" }));
        }
        lock2.updateTimeout && clearTimeout(lock2.updateTimeout);
        lock2.released = true;
        delete locks[file2];
        removeLock(file2, options, callback);
      });
    }
    function check(file, options, callback) {
      options = {
        stale: 1e4,
        realpath: true,
        fs: fs9,
        ...options
      };
      options.stale = Math.max(options.stale || 0, 2e3);
      resolveCanonicalPath(file, options, (err, file2) => {
        if (err) {
          return callback(err);
        }
        options.fs.stat(getLockFile(file2, options), (err2, stat) => {
          if (err2) {
            return err2.code === "ENOENT" ? callback(null, false) : callback(err2);
          }
          return callback(null, !isLockStale(stat, options));
        });
      });
    }
    function getLocks() {
      return locks;
    }
    onExit(() => {
      for (const file in locks) {
        const options = locks[file].options;
        try {
          options.fs.rmdirSync(getLockFile(file, options));
        } catch (e) {
        }
      }
    });
    module.exports.lock = lock;
    module.exports.unlock = unlock;
    module.exports.check = check;
    module.exports.getLocks = getLocks;
  }
});

// node_modules/proper-lockfile/lib/adapter.js
var require_adapter = __commonJS({
  "node_modules/proper-lockfile/lib/adapter.js"(exports, module) {
    "use strict";
    var fs9 = require_graceful_fs();
    function createSyncFs(fs10) {
      const methods = ["mkdir", "realpath", "stat", "rmdir", "utimes"];
      const newFs = { ...fs10 };
      methods.forEach((method) => {
        newFs[method] = (...args) => {
          const callback = args.pop();
          let ret;
          try {
            ret = fs10[`${method}Sync`](...args);
          } catch (err) {
            return callback(err);
          }
          callback(null, ret);
        };
      });
      return newFs;
    }
    function toPromise(method) {
      return (...args) => new Promise((resolve, reject) => {
        args.push((err, result) => {
          if (err) {
            reject(err);
          } else {
            resolve(result);
          }
        });
        method(...args);
      });
    }
    function toSync(method) {
      return (...args) => {
        let err;
        let result;
        args.push((_err, _result) => {
          err = _err;
          result = _result;
        });
        method(...args);
        if (err) {
          throw err;
        }
        return result;
      };
    }
    function toSyncOptions(options) {
      options = { ...options };
      options.fs = createSyncFs(options.fs || fs9);
      if (typeof options.retries === "number" && options.retries > 0 || options.retries && typeof options.retries.retries === "number" && options.retries.retries > 0) {
        throw Object.assign(new Error("Cannot use retries with the sync api"), { code: "ESYNC" });
      }
      return options;
    }
    module.exports = {
      toPromise,
      toSync,
      toSyncOptions
    };
  }
});

// node_modules/proper-lockfile/index.js
var require_proper_lockfile = __commonJS({
  "node_modules/proper-lockfile/index.js"(exports, module) {
    "use strict";
    var lockfile2 = require_lockfile();
    var { toPromise, toSync, toSyncOptions } = require_adapter();
    async function lock(file, options) {
      const release = await toPromise(lockfile2.lock)(file, options);
      return toPromise(release);
    }
    function lockSync(file, options) {
      const release = toSync(lockfile2.lock)(file, toSyncOptions(options));
      return toSync(release);
    }
    function unlock(file, options) {
      return toPromise(lockfile2.unlock)(file, options);
    }
    function unlockSync(file, options) {
      return toSync(lockfile2.unlock)(file, toSyncOptions(options));
    }
    function check(file, options) {
      return toPromise(lockfile2.check)(file, options);
    }
    function checkSync(file, options) {
      return toSync(lockfile2.check)(file, toSyncOptions(options));
    }
    module.exports = lock;
    module.exports.lock = lock;
    module.exports.unlock = unlock;
    module.exports.lockSync = lockSync;
    module.exports.unlockSync = unlockSync;
    module.exports.check = check;
    module.exports.checkSync = checkSync;
  }
});

// src/server/index.ts
import os2 from "node:os";
import path10 from "node:path";
import { execFile as execFile3 } from "node:child_process";
import { promises as fs8 } from "node:fs";
import { promisify as promisify3 } from "node:util";

// src/server/store.ts
import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { randomUUID } from "node:crypto";
import path2 from "node:path";

// src/server/lifecycle.ts
import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
var execFileAsync = promisify(execFile);
function resolvePluginDir() {
  const candidates = ["../../plugin/", "../../"];
  for (const rel of candidates) {
    const dir = fileURLToPath(new URL(rel, import.meta.url));
    if (existsSync(path.join(dir, "bin", "console-launch.sh"))) return dir;
  }
  return fileURLToPath(new URL("../../", import.meta.url));
}
var PLUGIN_DIR = resolvePluginDir();
var LAUNCH_SCRIPT = path.join(PLUGIN_DIR, "bin", "console-launch.sh");
var RESTART_SCRIPT = path.join(PLUGIN_DIR, "bin", "console-restart.sh");
function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}
function sparePidsFrom(psOutput) {
  const spares = /* @__PURE__ */ new Set();
  for (const line of psOutput.split("\n")) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (m && m[2].includes("bg-spare")) spares.add(Number(m[1]));
  }
  return spares;
}
async function recycledSpares(pids) {
  const wanted = pids.filter((p) => Number.isInteger(p) && p > 0);
  if (wanted.length === 0) return /* @__PURE__ */ new Set();
  try {
    const { stdout } = await execFileAsync("ps", ["-p", wanted.join(","), "-o", "pid=,command="]);
    return sparePidsFrom(stdout);
  } catch {
    return /* @__PURE__ */ new Set();
  }
}
async function hasLiveTeam(teamsRoot2, teamName) {
  if (!teamName) return false;
  const configPath = path.join(teamsRoot2, teamName, "config.json");
  try {
    const raw = await fs.readFile(configPath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.members) && parsed.members.length >= 2;
  } catch {
    return false;
  }
}
async function teamConfigExists(teamsRoot2, team) {
  try {
    return (await fs.stat(path.join(teamsRoot2, team, "config.json"))).isFile();
  } catch {
    return false;
  }
}
function startIdleReaper(opts) {
  let idleSince = null;
  const timer = setInterval(async () => {
    let any = false;
    try {
      for (const entry of await fs.readdir(opts.teamsRoot)) {
        if (await hasLiveTeam(opts.teamsRoot, entry)) {
          any = true;
          break;
        }
      }
    } catch {
      any = false;
    }
    if (any) {
      idleSince = null;
      return;
    }
    const watched = opts.watchedTeam?.();
    if (watched !== void 0 && watched !== "" && !await teamConfigExists(opts.teamsRoot, watched)) {
      clearInterval(timer);
      opts.onIdle();
      return;
    }
    idleSince ??= Date.now();
    if (Date.now() - idleSince >= opts.graceMs) {
      clearInterval(timer);
      opts.onIdle();
    }
  }, opts.tickMs ?? 3e4);
  timer.unref();
  return {
    stop() {
      clearInterval(timer);
    }
  };
}

// src/server/log.ts
var DEBUG_ON = process.env.OCTO_DEBUG === "1" || process.env.OCTO_DEBUG === "true";
function describe(err) {
  if (err instanceof Error) return err.stack ?? `${err.name}: ${err.message}`;
  return String(err);
}
function logError(scope, err) {
  try {
    console.error(`[octo] ${scope}: ${describe(err)}`);
  } catch {
  }
}
function logInfo(message) {
  try {
    console.error(`[octo] ${message}`);
  } catch {
  }
}
function debug(scope, message) {
  if (!DEBUG_ON) return;
  try {
    console.error(`[octo:debug] ${scope}: ${message}`);
  } catch {
  }
}

// src/shared/catalog.json
var catalog_default = {
  version: "2.1.231",
  outputReserve: 2e4,
  compactHeadroom: 13e3,
  fallbackModel: "claude-opus-5",
  fallbackWindow: 2e5,
  aliases: {
    opus: "claude-opus-5",
    sonnet: "claude-sonnet-5",
    haiku: "claude-haiku-4-5"
  },
  models: {
    "claude-fable-5": {
      window: 1e6,
      pricing: { input: 10, output: 50, cacheWrite5m: 12.5, cacheWrite1h: 20, cacheRead: 1, webSearch: 0.01 }
    },
    "claude-opus-5": {
      window: 1e6,
      pricing: { input: 5, output: 25, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5, webSearch: 0.01 }
    },
    "claude-sonnet-5": {
      window: 1e6,
      pricing: { input: 2, output: 10, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.2, webSearch: 0.01 }
    },
    "claude-haiku-4-5": {
      window: 2e5,
      pricing: { input: 1, output: 5, cacheWrite5m: 1.25, cacheWrite1h: 2, cacheRead: 0.1, webSearch: 0.01 }
    }
  }
};

// src/shared/catalog.ts
var catalog = catalog_default;
function compactAtFor(window) {
  return window - catalog.outputReserve - catalog.compactHeadroom;
}
function normalise(raw) {
  const lower = raw.trim().toLowerCase();
  const noWindowSuffix = lower.replace(/\[1m\]$/, "");
  const undated = noWindowSuffix.replace(/-\d{8}$/, "");
  return catalog.aliases[undated] ?? undated;
}
function resolveModel(raw) {
  const canonical = raw ? normalise(raw) : "";
  const entry = catalog.models[canonical];
  if (entry) {
    return {
      canonical,
      window: entry.window,
      compactAt: compactAtFor(entry.window),
      pricing: entry.pricing,
      approximate: false
    };
  }
  return {
    canonical: canonical || "unknown",
    window: catalog.fallbackWindow,
    compactAt: compactAtFor(catalog.fallbackWindow),
    pricing: catalog.models[catalog.fallbackModel].pricing,
    approximate: true
  };
}

// src/shared/usage.ts
function usageRecordsOf(records) {
  const out = [];
  for (const r of records) {
    if (r.type !== "assistant") continue;
    const usage = r.message?.usage;
    if (!usage) continue;
    out.push({
      messageId: r.message?.id ?? r.uuid ?? "",
      model: r.message?.model ?? "",
      usage
    });
  }
  return out;
}
function tokensOf(records) {
  let sum = 0;
  for (const r of records) {
    sum += (r.usage.input_tokens ?? 0) + (r.usage.output_tokens ?? 0) + (r.usage.cache_creation_input_tokens ?? 0);
  }
  return sum;
}
function dedupeUsage(records) {
  const best = /* @__PURE__ */ new Map();
  for (const record of records) {
    const previous = best.get(record.messageId);
    if (!previous || record.usage.output_tokens > previous.usage.output_tokens) {
      best.set(record.messageId, record);
    }
  }
  return [...best.values()];
}
function costOf(usage, tier) {
  const created = usage.cache_creation_input_tokens ?? 0;
  const oneHour = Math.min(usage.cache_creation?.ephemeral_1h_input_tokens ?? 0, created);
  const cacheCreation = (oneHour * tier.cacheWrite1h + (created - oneHour) * tier.cacheWrite5m) / 1e6;
  return usage.input_tokens * tier.input / 1e6 + usage.output_tokens * tier.output / 1e6 + (usage.cache_read_input_tokens ?? 0) * tier.cacheRead / 1e6 + cacheCreation + (usage.server_tool_use?.web_search_requests ?? 0) * tier.webSearch;
}
function totalCost(records) {
  let sum = 0;
  for (const record of dedupeUsage(records)) {
    sum += costOf(record.usage, resolveModel(record.model).pricing);
  }
  return sum;
}
function contextOccupancy(records) {
  let lastBoundary = -1;
  for (let i = 0; i < records.length; i++) {
    if (records[i].type === "system" && records[i].subtype === "compact_boundary") lastBoundary = i;
  }
  const after = lastBoundary === -1 ? records : records.slice(lastBoundary + 1);
  const assistants = after.filter(
    (r) => r.type === "assistant" && r.isApiErrorMessage !== true && r.message?.usage
  );
  const own = assistants.filter((r) => r.isSidechain !== true);
  const pool = own.length > 0 ? own : assistants;
  const last = pool[pool.length - 1];
  if (!last) {
    return lastBoundary === -1 ? 0 : records[lastBoundary].compactMetadata?.postTokens ?? 0;
  }
  const usage = last.message.usage;
  return usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
}

// src/shared/cost.ts
function splitTok(records) {
  const split = { in: 0, out: 0, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0 };
  for (const { usage } of dedupeUsage([...records])) {
    const created = usage.cache_creation_input_tokens ?? 0;
    split.in += usage.input_tokens ?? 0;
    split.out += usage.output_tokens ?? 0;
    split.cacheWrite += created;
    split.cacheWrite1h += Math.min(usage.cache_creation?.ephemeral_1h_input_tokens ?? 0, created);
    split.cacheRead += usage.cache_read_input_tokens ?? 0;
  }
  return split;
}

// src/server/store.ts
var KIND_RETENTION = {
  task: 5e3,
  mail: 2e3,
  hook: 2e3,
  substatus: 500,
  roster: 200,
  statusline: 200,
  // A resolution is a human action (approve/deny/dismiss a card), not a
  // background event, so 500 is many days of them even on a busy console —
  // and safe regardless: trim() always drops a resolution's matching
  // `needsyou` create alongside it, so nothing here is ever left dangling.
  "needsyou-resolved": 500,
  // One row per run per re-read, folded last-wins per runId, so this caps
  // re-reads and not runs. A LIVE run is re-appended on every journal append —
  // the only kind here whose row count grows with a run's length rather than
  // with how many there are — and 16 runs was the whole of a heavy week on the
  // capture machine. Rows are ~9 KB each with the script stripped (leanRun).
  workflow: 500,
  // One row per RUN per drain of any of its agent transcripts, folded last-wins
  // per runId. A live run re-appends as its agents write, so like `workflow`
  // this caps re-reads rather than runs. Rows are small by construction — the
  // per-agent totals plus a burn series capped at WORKFLOW_BURN_SAMPLES points,
  // never the turns behind them.
  "workflow-usage": 500,
  // One digest per subagent per drain, folded last-wins per toolUseId — so this
  // caps re-reads, not subagents. A LIVE subagent re-appends on every drain of
  // its transcript, and a fan-out runs several at once, which is why the cap is
  // higher than workflow's: a digest is a few hundred bytes, not nine kilobytes.
  subagent: 2e3
};
var TRANSCRIPT_RECORDS_PER_AGENT = 1e3;
var TRANSCRIPT_EVENTS_PER_AGENT = 1200;
var PRUNE_EVERY = 250;
var TEAM_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$/;
function isTeamName(team) {
  return TEAM_NAME.test(team);
}
function logPathFor(dbPath, team) {
  const name = isTeamName(team) ? team : "unknown";
  return path2.join(path2.dirname(dbPath), "logs", `${name}.jsonl`);
}
function runsDirFor(dbPath) {
  return path2.join(path2.dirname(dbPath), "logs", "runs");
}
function scratchLogPath(dbPath, runId) {
  return path2.join(runsDirFor(dbPath), `${runId}.jsonl`);
}
var STALE_LOG_MS = 7 * 24 * 60 * 60 * 1e3;
function encode(event, team) {
  return `${JSON.stringify({ ...event, team })}
`;
}
function decode(line) {
  let raw;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof raw?.seq !== "number" || typeof raw.ts !== "number" || typeof raw.kind !== "string") {
    return null;
  }
  return {
    // A log written before the log was team-scoped has no `team`.
    team: typeof raw.team === "string" ? raw.team : "",
    event: {
      seq: raw.seq,
      ts: raw.ts,
      kind: raw.kind,
      agent: typeof raw.agent === "string" ? raw.agent : void 0,
      payload: raw.payload ?? null
    }
  };
}
function needsYouId(payload) {
  const id = payload && typeof payload === "object" ? payload.id : void 0;
  return typeof id === "string" ? id : void 0;
}
function recordCount(payload) {
  const recs = payload && typeof payload === "object" ? payload.records : void 0;
  return Array.isArray(recs) ? recs.length : 0;
}
function readsFromStart(payload) {
  return payload !== null && typeof payload === "object" && payload.fromStart === true;
}
function carriesTotals(payload) {
  return payload !== null && typeof payload === "object" && payload.totals != null;
}
function totalsOf(payload) {
  const totals = payload && typeof payload === "object" ? payload.totals : void 0;
  return totals != null && typeof totals === "object" ? totals : void 0;
}
function recordsOf(payload) {
  const recs = payload && typeof payload === "object" ? payload.records : void 0;
  return Array.isArray(recs) ? recs : [];
}
function usageFrom(rows) {
  const recs = [];
  for (const e of rows) for (const r of recordsOf(e.payload)) if (r != null) recs.push(r);
  const usage = dedupeUsage(usageRecordsOf(recs));
  return { costUsd: totalCost(usage), tokens: tokensOf(usage), split: splitTok(usage) };
}
function withTotals(e, totals) {
  return { ...e, payload: { ...e.payload, totals } };
}
function withNewestRecords(e, keep) {
  const payload = e.payload;
  const records = payload.records;
  return { ...e, payload: { ...payload, records: records.slice(records.length - keep) } };
}
function readableRows(events, agent) {
  const rows = [];
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind !== "transcript" || (e.agent ?? "") !== agent) continue;
    rows.push(e);
    if (readsFromStart(e.payload)) break;
  }
  return rows.reverse();
}
function transcriptDrops(events) {
  const drop = /* @__PURE__ */ new Set();
  const trimmed = /* @__PURE__ */ new Map();
  const keptRecords = /* @__PURE__ */ new Map();
  const keptEvents = /* @__PURE__ */ new Map();
  const pastReset = /* @__PURE__ */ new Set();
  const newestKept = /* @__PURE__ */ new Map();
  const newestTotals = /* @__PURE__ */ new Map();
  const losing = /* @__PURE__ */ new Set();
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind !== "transcript") continue;
    const agent = e.agent ?? "";
    if (!newestTotals.has(agent) && carriesTotals(e.payload)) newestTotals.set(agent, e);
    if (pastReset.has(agent)) {
      drop.add(e);
      losing.add(agent);
      continue;
    }
    if (readsFromStart(e.payload)) pastReset.add(agent);
    const records = keptRecords.get(agent) ?? 0;
    const count = keptEvents.get(agent) ?? 0;
    if (records >= TRANSCRIPT_RECORDS_PER_AGENT || count >= TRANSCRIPT_EVENTS_PER_AGENT) {
      drop.add(e);
      losing.add(agent);
      continue;
    }
    const held = recordCount(e.payload);
    const room = TRANSCRIPT_RECORDS_PER_AGENT - records;
    if (held > room) {
      trimmed.set(e, withNewestRecords(e, room));
      keptRecords.set(agent, TRANSCRIPT_RECORDS_PER_AGENT);
      losing.add(agent);
    } else {
      keptRecords.set(agent, records + held);
    }
    keptEvents.set(agent, count + 1);
    if (!newestKept.has(agent) && e.payload !== null && typeof e.payload === "object") {
      newestKept.set(agent, e);
    }
  }
  for (const agent of losing) {
    const survivor = newestKept.get(agent);
    if (!survivor) continue;
    const winner = newestTotals.get(agent);
    if (winner && !drop.has(winner)) continue;
    const carried = winner && totalsOf(winner.payload) || usageFrom(readableRows(events, agent));
    trimmed.set(survivor, withTotals(trimmed.get(survivor) ?? survivor, carried));
  }
  return { drop, trimmed };
}
function trim(events) {
  const counts = /* @__PURE__ */ new Map();
  for (const e of events) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  const excess = /* @__PURE__ */ new Map();
  for (const [kind, keep] of Object.entries(KIND_RETENTION)) {
    const over = (counts.get(kind) ?? 0) - keep;
    if (over > 0) excess.set(kind, over);
  }
  const { drop: transcripts, trimmed } = transcriptDrops(events);
  if (excess.size === 0 && transcripts.size === 0 && trimmed.size === 0) return events;
  const closedIds = /* @__PURE__ */ new Set();
  let closedOver = excess.get("needsyou-resolved") ?? 0;
  for (const e of events) {
    if (closedOver <= 0) break;
    if (e.kind !== "needsyou-resolved") continue;
    const id = needsYouId(e.payload);
    if (id) closedIds.add(id);
    closedOver--;
  }
  const kept = events.filter((e) => {
    if (transcripts.has(e)) return false;
    if (e.kind === "needsyou") {
      const id = needsYouId(e.payload);
      if (id && closedIds.has(id)) return false;
    }
    const over = excess.get(e.kind);
    if (!over) return true;
    excess.set(e.kind, over - 1);
    return false;
  });
  return trimmed.size === 0 ? kept : kept.map((e) => trimmed.get(e) ?? e);
}
function gcStaleLogs(dir, keep) {
  const cutoff = Date.now() - STALE_LOG_MS;
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.endsWith(".jsonl") && !name.endsWith(".tmp")) continue;
    const candidate = path2.join(dir, name);
    if (candidate === keep) continue;
    try {
      if (statSync(candidate).mtimeMs < cutoff) unlinkSync(candidate);
    } catch {
    }
  }
}
function sizeOf(file) {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}
function rowKey(e) {
  return `${e.ts} ${e.kind} ${e.agent ?? ""} ${JSON.stringify(e.payload)}`;
}
function migrateLegacyLog(dbPath, runId) {
  let contents;
  try {
    contents = readFileSync(dbPath, "utf8");
  } catch {
    return;
  }
  const byTeam = /* @__PURE__ */ new Map();
  for (const line of contents.split("\n")) {
    if (!line) continue;
    const record = decode(line);
    if (!record || !isTeamName(record.team)) continue;
    const rows = byTeam.get(record.team) ?? [];
    rows.push(record.event);
    byTeam.set(record.team, rows);
  }
  let recovered = 0;
  let touched = 0;
  let deferred = 0;
  for (const [team, legacy] of byTeam) {
    const file = logPathFor(dbPath, team);
    const before = sizeOf(file);
    const tmp = `${file}.${runId}.tmp`;
    try {
      const existing = [];
      if (before > 0) {
        for (const line of readFileSync(file, "utf8").split("\n")) {
          if (!line) continue;
          const record = decode(line);
          if (record) existing.push(record.event);
        }
      }
      const have = new Set(existing.map(rowKey));
      const fresh = legacy.filter((e) => !have.has(rowKey(e)));
      if (fresh.length === 0) continue;
      const out = [];
      let l = 0;
      let n = 0;
      while (l < fresh.length || n < existing.length) {
        const takeLegacy = n >= existing.length || l < fresh.length && fresh[l].ts <= existing[n].ts;
        out.push(takeLegacy ? fresh[l++] : existing[n++]);
      }
      writeFileSync(tmp, out.map((e, i) => encode({ ...e, seq: i + 1 }, team)).join(""));
      if (sizeOf(file) !== before) {
        unlinkSync(tmp);
        deferred++;
        continue;
      }
      renameSync(tmp, file);
      recovered += fresh.length;
      touched++;
    } catch (err) {
      logError(`migrating ${team}`, err);
      deferred++;
    }
  }
  const base = path2.basename(dbPath);
  if (deferred > 0) {
    logInfo(
      `recovered ${recovered} row(s) from ${base} into ${touched} team log(s); ${deferred} team log(s) are open in another console, so ${base} is left in place and the next start retries`
    );
    return;
  }
  const aside = `${dbPath}.migrated-${Date.now()}`;
  try {
    renameSync(dbPath, aside);
  } catch (err) {
    if (err.code !== "ENOENT") logError(`renaming ${base} aside`, err);
    return;
  }
  logInfo(
    `recovered ${recovered} row(s) from ${base} into ${touched} team log(s); the original is at ${aside}`
  );
}
function ownerPathFor(file) {
  return `${file}.owner`;
}
function stampOwner(file) {
  const owner = ownerPathFor(file);
  try {
    const prev = JSON.parse(readFileSync(owner, "utf8"));
    const pid = typeof prev.pid === "number" ? prev.pid : 0;
    if (pid && pid !== process.pid && isPidAlive(pid)) {
      logInfo(
        `${file} is already open in process ${pid} \u2014 two consoles on one team log double every ingested row, and each can only resolve its own permission cards`
      );
    }
  } catch {
  }
  try {
    writeFileSync(owner, `${JSON.stringify({ pid: process.pid, since: Date.now() })}
`);
  } catch (err) {
    logError(`stamping ${owner}`, err);
  }
}
function clearOwner(file) {
  const owner = ownerPathFor(file);
  try {
    const prev = JSON.parse(readFileSync(owner, "utf8"));
    if (prev.pid !== process.pid) return;
    unlinkSync(owner);
  } catch {
  }
}
function openStore(dbPath, team = "") {
  const runId = `${process.pid}-${randomUUID().slice(0, 8)}`;
  let current = isTeamName(team) ? team : "";
  let file = current === "" ? scratchLogPath(dbPath, runId) : logPathFor(dbPath, current);
  const logsDir = path2.join(path2.dirname(dbPath), "logs");
  const runsDir = runsDirFor(dbPath);
  mkdirSync(runsDir, { recursive: true });
  migrateLegacyLog(dbPath, runId);
  gcStaleLogs(logsDir, file);
  gcStaleLogs(runsDir, file);
  if (current !== "") stampOwner(file);
  let sincePrune = 0;
  let nextSeq = 1;
  let events = [];
  let dirty = false;
  let accounted = 0;
  let warnedShared = false;
  const load = () => {
    events = [];
    nextSeq = 1;
    let buf;
    try {
      buf = readFileSync(file);
    } catch {
      buf = Buffer.alloc(0);
    }
    accounted = buf.length;
    for (const line of buf.toString("utf8").split("\n")) {
      if (!line) continue;
      const record = decode(line);
      if (!record) {
        dirty = true;
        continue;
      }
      if (record.event.seq >= nextSeq) nextSeq = record.event.seq + 1;
      if (record.team === current) events.push(record.event);
    }
  };
  const rewrite = () => {
    const size = sizeOf(file);
    if (size !== accounted) {
      if (!warnedShared) {
        warnedShared = true;
        logInfo(
          `${file} holds ${size - accounted} bytes this run did not write \u2014 another console is writing the same team log, so this one will stop compacting it`
        );
      }
      return false;
    }
    const body = events.map((e) => encode(e, current)).join("");
    const tmp = `${file}.${runId}.tmp`;
    writeFileSync(tmp, body);
    renameSync(tmp, file);
    accounted = Buffer.byteLength(body);
    return true;
  };
  const discardScratch = (scratch) => {
    try {
      unlinkSync(scratch);
    } catch {
    }
  };
  load();
  const loaded = events;
  events = trim(events);
  if (dirty || events !== loaded) {
    if (rewrite()) dirty = false;
  }
  return {
    append(kind, payload, agent) {
      const ts = Date.now();
      const seq = nextSeq++;
      const event = { seq, ts, kind, agent, payload: payload ?? null };
      events.push(event);
      const encoded = encode(event, current);
      appendFileSync(file, encoded);
      accounted += Buffer.byteLength(encoded);
      if (++sincePrune >= PRUNE_EVERY) {
        sincePrune = 0;
        const before = events;
        events = trim(events);
        if (events !== before) rewrite();
      }
      return { seq, ts, kind, agent, payload };
    },
    // The array is a copy; the rows in it are not. project() memoises each
    // record's derived lines on the record object, so handing back copies here
    // would leave the console correct and silently 18x slower.
    replay() {
      return events.slice();
    },
    setTeam(next) {
      if (next === current || !isTeamName(next)) return;
      const wasScratch = current === "";
      const adopted = wasScratch ? events : [];
      const scratch = file;
      current = next;
      file = logPathFor(dbPath, current);
      stampOwner(file);
      load();
      for (const e of adopted) {
        const moved = { ...e, seq: nextSeq++ };
        events.push(moved);
        const encoded = encode(moved, current);
        appendFileSync(file, encoded);
        accounted += Buffer.byteLength(encoded);
      }
      const before = events;
      events = trim(events);
      if (dirty || events !== before) {
        if (rewrite()) dirty = false;
      }
      if (wasScratch) discardScratch(scratch);
      else clearOwner(scratch);
    },
    close() {
      if (current === "") discardScratch(file);
      else clearOwner(file);
    }
  };
}

// src/shared/subagents.ts
var SUBAGENT_SUMMARY_CAP = 400;
var SUBAGENT_TOOLS = /* @__PURE__ */ new Set(["Task", "Agent"]);
function emptySubagentFold() {
  return {
    records: 0,
    toolCalls: 0,
    contextTokens: 0,
    usage: /* @__PURE__ */ new Map(),
    spawns: [],
    at: /* @__PURE__ */ new Map()
  };
}
function digestOf(fold) {
  return {
    records: fold.records,
    startedAt: fold.startedAt,
    lastAt: fold.lastAt,
    tokens: tokensOf([...fold.usage.values()]),
    toolCalls: fold.toolCalls,
    contextTokens: fold.contextTokens,
    summary: fold.summary,
    spawns: fold.spawns
  };
}
function cap(s) {
  if (s.length <= SUBAGENT_SUMMARY_CAP) return s;
  return `${s.slice(0, SUBAGENT_SUMMARY_CAP - 1).replace(/[\uD800-\uDBFF]$/, "")}\u2026`;
}
function flatten(content) {
  if (typeof content === "string") return content.replace(/\s+/g, " ").trim();
  if (Array.isArray(content)) {
    return content.map((block) => {
      if (block && typeof block === "object") {
        const text = block.text;
        if (typeof text === "string") return text;
      }
      return "";
    }).join(" ").replace(/\s+/g, " ").trim();
  }
  return "";
}
function str(value) {
  return typeof value === "string" && value !== "" ? value : void 0;
}
var NOTIFICATION = /<task-notification>([\s\S]*?)<\/task-notification>/;
var NOTIFIED_TOOL_USE = /<tool-use-id>([\s\S]*?)<\/tool-use-id>/;
var NOTIFIED_STATUS = /<status>([\s\S]*?)<\/status>/;
var NOTIFIED_SUMMARY = /<summary>([\s\S]*?)<\/summary>/;
function notificationOf(rec) {
  const content = rec.message?.content;
  const text = typeof content === "string" ? content : rec.attachment?.prompt;
  if (typeof text !== "string" || !text.includes("<task-notification>")) return null;
  const body = NOTIFICATION.exec(text)?.[1];
  if (!body) return null;
  const toolUseId = str(NOTIFIED_TOOL_USE.exec(body)?.[1]?.trim());
  if (!toolUseId) return null;
  const ts = rec.timestamp ? Date.parse(rec.timestamp) : NaN;
  if (Number.isNaN(ts)) return null;
  const status = NOTIFIED_STATUS.exec(body)?.[1]?.trim();
  const summary = str(NOTIFIED_SUMMARY.exec(body)?.[1]?.trim());
  return {
    kind: "update",
    toolUseId,
    returnedAt: ts,
    ...summary ? { returnedSummary: cap(summary) } : {},
    // Every notification observed so far reads `completed`; anything else is
    // the runtime saying it did not, so it is reported rather than smoothed.
    ...status !== void 0 && status !== "completed" ? { failed: true } : {}
  };
}
function spawnEventsOf(rec) {
  const events = [];
  const notified = notificationOf(rec);
  if (notified) events.push(notified);
  const content = rec.message?.content;
  if (!Array.isArray(content)) return events;
  const ts = rec.timestamp ? Date.parse(rec.timestamp) : NaN;
  if (Number.isNaN(ts)) return events;
  const raw = rec.toolUseResult;
  const result = raw && typeof raw === "object" ? raw : void 0;
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block;
    if (rec.type === "assistant" && b.type === "tool_use" && SUBAGENT_TOOLS.has(b.name ?? "")) {
      if (typeof b.id !== "string" || !rec.uuid) continue;
      const input = b.input && typeof b.input === "object" ? b.input : {};
      const spawn = { toolUseId: b.id, siblingGroup: rec.uuid, queuedAt: ts };
      const name = str(input.name);
      const description = str(input.description);
      const agentType = str(input.subagent_type);
      const model = str(input.model);
      if (name) spawn.name = name;
      if (description) spawn.description = description;
      if (agentType) spawn.agentType = agentType;
      if (model) spawn.model = model;
      events.push({ kind: "dispatch", spawn });
    } else if (rec.type === "user" && b.type === "tool_result" && typeof b.tool_use_id === "string") {
      if (result?.status === "teammate_spawned" || typeof result?.teammate_id === "string" || typeof result?.runId === "string") {
        events.push({ kind: "retract", toolUseId: b.tool_use_id });
        continue;
      }
      const agentId = str(result?.agentId);
      const launched = result?.status === "async_launched" || result?.isAsync === true;
      events.push({
        kind: "update",
        toolUseId: b.tool_use_id,
        ...agentId ? { agentId } : {},
        ...launched ? {} : { returnedAt: ts, content: b.content, failed: b.is_error === true }
      });
    }
  }
  return events;
}
function applySpawnEvents(fold, events) {
  for (const event of events) {
    if (event.kind === "dispatch") {
      if (fold.at.has(event.spawn.toolUseId)) continue;
      fold.at.set(event.spawn.toolUseId, fold.spawns.length);
      fold.spawns.push(event.spawn);
      continue;
    }
    if (event.kind === "retract") {
      const gone = fold.at.get(event.toolUseId);
      if (gone === void 0) continue;
      fold.spawns.splice(gone, 1);
      fold.at.clear();
      fold.spawns.forEach((s, i) => fold.at.set(s.toolUseId, i));
      continue;
    }
    const at = fold.at.get(event.toolUseId);
    if (at === void 0) continue;
    const spawn = fold.spawns[at];
    if (event.agentId) spawn.agentId = event.agentId;
    if (event.returnedAt !== void 0) spawn.returnedAt = event.returnedAt;
    if (event.failed) spawn.failed = true;
    const summary = event.returnedSummary ?? (event.content === void 0 ? void 0 : flatten(event.content));
    if (summary) spawn.returnedSummary = cap(summary);
  }
}
function bearsContext(rec) {
  if (rec.type === "system") return rec.subtype === "compact_boundary";
  return rec.type === "assistant" && rec.isApiErrorMessage !== true && rec.message?.usage != null;
}
function foldSubagentRecords(fold, records) {
  let moved = false;
  for (const rec of records) {
    fold.records++;
    const ts = rec.timestamp ? Date.parse(rec.timestamp) : NaN;
    if (!Number.isNaN(ts)) {
      if (fold.startedAt === void 0 || ts < fold.startedAt) fold.startedAt = ts;
      if (fold.lastAt === void 0 || ts > fold.lastAt) fold.lastAt = ts;
    }
    const content = rec.message?.content;
    if (rec.type === "assistant" && Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== "object") continue;
        const b = block;
        if (b.type === "tool_use") fold.toolCalls++;
        else if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
          fold.summary = cap(b.text.replace(/\s+/g, " ").trim());
        }
      }
    }
    if (bearsContext(rec)) moved = true;
    applySpawnEvents(fold, spawnEventsOf(rec));
  }
  for (const u of usageRecordsOf(records)) {
    const best = fold.usage.get(u.messageId);
    if (!best || u.usage.output_tokens > best.usage.output_tokens) fold.usage.set(u.messageId, u);
  }
  if (moved) fold.contextTokens = contextOccupancy(records);
}
function stateOf(spawn, digest) {
  if (spawn.failed) return "failed";
  if (spawn.returnedAt !== void 0) return "returned";
  return digest && digest.records > 0 ? "running" : "queued";
}
function nodesOf(spawns, agent, parent, depth, facts, seen) {
  const out = [];
  for (let i = 0; i < spawns.length; i++) {
    const spawn = spawns[i];
    if (seen.has(spawn.toolUseId)) continue;
    seen.add(spawn.toolUseId);
    const found = facts.get(spawn.toolUseId);
    const digest = found?.digest;
    const started = digest && digest.records > 0 ? digest.startedAt : void 0;
    const node = {
      toolUseId: spawn.toolUseId,
      name: found?.meta?.name ?? spawn.name ?? spawn.description ?? found?.agentId ?? spawn.agentId ?? spawn.toolUseId,
      agent,
      parent,
      depth,
      spawnIndex: i,
      siblingGroup: spawn.siblingGroup,
      state: stateOf(spawn, digest),
      queuedAt: spawn.queuedAt,
      children: nodesOf(digest?.spawns ?? [], agent, spawn.toolUseId, depth + 1, facts, seen)
    };
    const agentId = found?.agentId ?? spawn.agentId;
    const agentType = found?.meta?.agentType ?? spawn.agentType;
    const model = found?.meta?.model ?? spawn.model;
    const description = spawn.description ?? found?.meta?.description;
    if (agentId) node.agentId = agentId;
    if (agentType) node.agentType = agentType;
    if (model) node.model = model;
    if (description) node.description = description;
    if (started !== void 0) node.startedAt = started;
    if (spawn.returnedAt !== void 0) {
      node.returnedAt = spawn.returnedAt;
      node.durationMs = spawn.returnedAt - (started ?? spawn.queuedAt);
    }
    if (spawn.returnedSummary) node.returnedSummary = spawn.returnedSummary;
    if (digest && digest.records > 0) {
      node.tokens = digest.tokens;
      node.toolCalls = digest.toolCalls;
      node.contextTokens = digest.contextTokens;
      if (!node.returnedSummary && digest.summary) node.returnedSummary = digest.summary;
    }
    out.push(node);
  }
  return out;
}
function buildSubagentTree(roots, facts) {
  const tree = {};
  for (const root of roots) {
    const nodes = nodesOf(root.spawns, root.agent, root.agent, 1, facts, /* @__PURE__ */ new Set());
    if (nodes.length > 0) tree[root.agent] = nodes;
  }
  return tree;
}

// src/shared/roster.ts
var ROLE_MAX = 80;
function typeFromSidecar(meta) {
  if (!meta) return "";
  return meta.agentType && meta.agentType !== meta.name ? meta.agentType : "";
}
function roleOf(meta, prompt) {
  const described = meta?.description?.trim();
  if (described) return described;
  const flat = (prompt ?? "").replace(/\s+/g, " ").trim();
  return flat.length > ROLE_MAX ? `${flat.slice(0, ROLE_MAX)}\u2026` : flat;
}
function buildRoster(config, sidecars) {
  const byName = new Map(sidecars.map((s) => [s.meta.name, s]));
  const roster = [];
  const claimed = /* @__PURE__ */ new Set();
  for (const member of config?.members ?? []) {
    const sidecar = byName.get(member.name);
    roster.push({
      name: member.name,
      agentId: member.agentId,
      isLead: member.agentId === config?.leadAgentId,
      agentType: member.agentType ?? typeFromSidecar(sidecar?.meta),
      rawModel: member.model ?? sidecar?.meta.model,
      role: roleOf(sidecar?.meta, member.prompt),
      color: member.color ?? sidecar?.meta.color,
      joinedAt: member.joinedAt,
      transcriptPath: sidecar?.transcriptPath
    });
    claimed.add(member.name);
  }
  for (const sidecar of sidecars) {
    if (claimed.has(sidecar.meta.name)) continue;
    roster.push({
      name: sidecar.meta.name,
      agentId: `${sidecar.meta.name}@${sidecar.meta.teamName}`,
      isLead: false,
      agentType: typeFromSidecar(sidecar.meta),
      rawModel: sidecar.meta.model,
      role: roleOf(sidecar.meta, void 0),
      color: sidecar.meta.color,
      joinedAt: 0,
      transcriptPath: sidecar.transcriptPath
    });
  }
  return roster;
}

// src/shared/domain.ts
var DIFF_LINES_CAP = 300;
var DIFF_LINE_TEXT_CAP = 200;
var CONSOLE_SENDER = "console";
var WORKFLOW_BURN_SAMPLES = 60;

// src/shared/mailbox.ts
var PROTOCOL_TYPES = /* @__PURE__ */ new Set([
  "task_assignment",
  "task_completed",
  "idle_notification",
  "plan_approval_request",
  "plan_approval_response",
  "permission_request",
  "permission_response",
  "shutdown_request",
  "shutdown_approved",
  "shutdown_rejected",
  "mode_set_request",
  "teammate_terminated"
]);
var FRAME_RE = /<teammate-message\s+([^>]*?)>\r?\n?([\s\S]*?)\r?\n?<\/teammate-message>/g;
var ATTR_RE = /(\w+)="([^"]*)"/g;
function fnv1a32(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
function synthMsgId(from, text, ts) {
  return `bk-${fnv1a32(`${from}\0${text}\0${ts}`)}`;
}
function detectProtocol(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return void 0;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return void 0;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return void 0;
  const data = parsed;
  const type = data.type;
  if (typeof type !== "string" || !PROTOCOL_TYPES.has(type)) return void 0;
  return { type, data };
}
function parseInboxEntry(e, to) {
  const parsedTs = Date.parse(e.timestamp);
  const ts = Number.isNaN(parsedTs) ? 0 : parsedTs;
  return {
    msgId: e.msg_id ?? synthMsgId(e.from, e.text, ts),
    from: e.from,
    to,
    text: e.text,
    summary: e.summary,
    ts,
    tsIsDelivery: false,
    read: e.read === true,
    color: e.color,
    protocol: detectProtocol(e.text)
  };
}
function parseTeammateFrames(text, deliveredAt, to) {
  const out = [];
  FRAME_RE.lastIndex = 0;
  let frame2;
  while ((frame2 = FRAME_RE.exec(text)) !== null) {
    const attrs = {};
    ATTR_RE.lastIndex = 0;
    let attr;
    while ((attr = ATTR_RE.exec(frame2[1])) !== null) attrs[attr[1]] = attr[2];
    const from = attrs.teammate_id;
    if (!from) continue;
    const body = frame2[2];
    out.push({
      msgId: synthMsgId(from, body, deliveredAt),
      from,
      to,
      text: body,
      summary: attrs.summary,
      ts: deliveredAt,
      tsIsDelivery: true,
      // A frame in the recipient's own transcript is the message inside its
      // context window: it was drained at that turn boundary by definition.
      read: true,
      color: attrs.color,
      protocol: detectProtocol(body)
    });
  }
  return out;
}
function splitTeammateDelivery(text) {
  const parts = [];
  FRAME_RE.lastIndex = 0;
  let at = 0;
  let frame2;
  while ((frame2 = FRAME_RE.exec(text)) !== null) {
    const attrs = {};
    ATTR_RE.lastIndex = 0;
    let attr;
    while ((attr = ATTR_RE.exec(frame2[1])) !== null) attrs[attr[1]] = attr[2];
    if (frame2.index > at) parts.push({ text: text.slice(at, frame2.index) });
    parts.push(attrs.teammate_id ? { from: attrs.teammate_id, text: frame2[2] } : { text: frame2[2] });
    at = frame2.index + frame2[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts.length > 0 ? parts : [{ text }];
}
function contentKey(m) {
  return `${m.from}\0${m.to}\0${m.text}`;
}
function mergeMail(existing, incoming) {
  const all = [...existing, ...incoming];
  const ordered = [...all.filter((m) => !m.tsIsDelivery), ...all.filter((m) => m.tsIsDelivery)];
  const canonicalId = /* @__PURE__ */ new Map();
  const kept = /* @__PURE__ */ new Map();
  for (const message of ordered) {
    const key = contentKey(message);
    const id = canonicalId.get(key) ?? message.msgId;
    canonicalId.set(key, id);
    const previous = kept.get(id);
    if (!previous) {
      kept.set(id, { ...message, msgId: id });
      continue;
    }
    const read = previous.read || message.read;
    if (previous.tsIsDelivery && !message.tsIsDelivery) kept.set(id, { ...message, msgId: id, read });
    else if (read !== previous.read) kept.set(id, { ...previous, read });
  }
  return [...kept.values()].sort((a, b) => a.ts - b.ts);
}

// src/shared/transcript.ts
var TRANSCRIPT_TEXT_CAP = 1e3;
var TOOL_INPUT_KEYS = [
  "command",
  "file_path",
  "path",
  "pattern",
  "query",
  "url",
  "prompt",
  "message",
  "subject",
  "description",
  "taskId"
];
var INDENT = /^[^\S\n]*/;
function tidy(s) {
  return s.split("\n").map((line) => {
    const indent = INDENT.exec(line)[0];
    const body = line.slice(indent.length).replace(/[^\S\n]+/g, " ").trimEnd();
    return body ? indent + body : "";
  }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
var LEADING_CD = /^cd[^\S\n]+("[^"]*"|'[^']*'|\S+)[^\S\n]*(?:&&|;|\n)\s*/;
function capText(s) {
  if (s.length <= TRANSCRIPT_TEXT_CAP) return s;
  return `${s.slice(0, TRANSCRIPT_TEXT_CAP - 1).replace(/[\uD800-\uDBFF]$/, "")}\u2026`;
}
function parseLine(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed;
}
function describeTool(name, input) {
  if (!input || typeof input !== "object") return name;
  const fields = input;
  for (const key of TOOL_INPUT_KEYS) {
    const value = fields[key];
    if (typeof value === "string" && value.trim()) {
      const shown = name === "Bash" ? value.replace(LEADING_CD, "") : value;
      return capText(`${name}(${tidy(shown)})`);
    }
  }
  return name;
}
function lineDiff(oldText, newText) {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const n = oldLines.length;
  const m = newLines.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i2 = n - 1; i2 >= 0; i2--) {
    for (let j2 = m - 1; j2 >= 0; j2--) {
      dp[i2][j2] = oldLines[i2] === newLines[j2] ? dp[i2 + 1][j2 + 1] + 1 : Math.max(dp[i2 + 1][j2], dp[i2][j2 + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ sign: " ", text: oldLines[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ sign: "-", text: oldLines[i] });
      i++;
    } else {
      ops.push({ sign: "+", text: newLines[j] });
      j++;
    }
  }
  while (i < n) ops.push({ sign: "-", text: oldLines[i++] });
  while (j < m) ops.push({ sign: "+", text: newLines[j++] });
  return ops;
}
var LCS_CELL_BUDGET = 5e5;
function diffOfToolUse(name, input, agent, ts) {
  if (!input || typeof input !== "object") return void 0;
  const fields = input;
  const filePath = fields.file_path;
  if (typeof filePath !== "string" || !filePath) return void 0;
  let ops;
  if (name === "Edit" && typeof fields.old_string === "string" && typeof fields.new_string === "string") {
    const oldText = fields.old_string;
    const newText = fields.new_string;
    ops = (oldText.split("\n").length + 1) * (newText.split("\n").length + 1) <= LCS_CELL_BUDGET ? lineDiff(oldText, newText) : [
      ...oldText.split("\n").map((text) => ({ sign: "-", text })),
      ...newText.split("\n").map((text) => ({ sign: "+", text }))
    ];
  } else if (name === "Write" && typeof fields.content === "string") {
    ops = fields.content.split("\n").map((text) => ({ sign: "+", text }));
  } else {
    return void 0;
  }
  const added = ops.filter((o) => o.sign === "+").length;
  const removed = ops.filter((o) => o.sign === "-").length;
  const lineCapped = ops.length > DIFF_LINES_CAP;
  const kept = lineCapped ? ops.slice(0, DIFF_LINES_CAP) : ops;
  let textCapped = false;
  let oldLine = 1;
  let newLine = 1;
  const lines = kept.map(({ sign, text }) => {
    const oldLineNo = sign === "+" ? null : oldLine;
    const newLineNo = sign === "-" ? null : newLine;
    if (sign !== "+") oldLine++;
    if (sign !== "-") newLine++;
    let shown = text;
    if (shown.length > DIFF_LINE_TEXT_CAP) {
      textCapped = true;
      shown = `${shown.slice(0, DIFF_LINE_TEXT_CAP - 1)}\u2026`;
    }
    return { sign, oldLineNo, newLineNo, text: shown };
  });
  const oldCount = lines.filter((l) => l.sign !== "+").length;
  const newCount = lines.filter((l) => l.sign !== "-").length;
  const hunk = { header: `@@ -1,${oldCount} +1,${newCount} @@`, lines };
  const diff = { path: filePath, added, removed, agent, ts, hunks: [hunk] };
  if (lineCapped || textCapped) diff.truncated = true;
  return diff;
}
function deliveryDrafts(content) {
  const drafts = [];
  for (const part of splitTeammateDelivery(content)) {
    const text = tidy(part.text);
    if (!text) continue;
    const marker = markerForUserText(part.text);
    if (part.from === void 0) {
      drafts.push({ marker, text });
      continue;
    }
    drafts.push({ marker: marker === "\u276F" ? "\u2709" : marker, text, sender: part.from });
  }
  return drafts;
}
function markerForUserText(body) {
  const trimmed = body.trim();
  if (trimmed.startsWith("{")) {
    try {
      const frame2 = JSON.parse(trimmed);
      if (frame2.type === "idle_notification") return "\u25CB";
      if (typeof frame2.type === "string" && frame2.type.endsWith("_request")) return "\u25B2";
    } catch {
    }
  }
  return "\u276F";
}
function markerForResult(text, isError) {
  if (isError) return "\u2717";
  if (/\b\d+ insertions?\(\+\)|\b\d+ deletions?\(-\)/.test(text)) return "+";
  if (/^(error|warning|failed|found \d+)/i.test(text)) return "!";
  if (/^(updated|created|wrote|applied|added|completed|done|success)/i.test(text)) return "\u2713";
  return "\u23BF";
}
function resultText(content) {
  if (typeof content === "string") return tidy(content);
  if (Array.isArray(content)) {
    return tidy(
      content.map((block) => {
        if (block && typeof block === "object") {
          const text = block.text;
          if (typeof text === "string") return text;
        }
        return JSON.stringify(block);
      }).join(" ")
    );
  }
  return tidy(JSON.stringify(content ?? ""));
}
function draftsOf(rec, agent = "") {
  if (!rec.uuid || !rec.timestamp) return null;
  const ts = Date.parse(rec.timestamp);
  if (Number.isNaN(ts)) return null;
  const drafts = [];
  const content = rec.message?.content;
  if (rec.type === "user") {
    if (typeof content === "string") {
      for (const draft of deliveryDrafts(content)) drafts.push(draft);
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== "object") continue;
        const b = block;
        if (b.type === "tool_result") {
          const text = resultText(b.content);
          if (text) drafts.push({ marker: markerForResult(text, b.is_error === true), text });
        } else if (b.type === "text" && typeof b.text === "string") {
          const text = tidy(b.text);
          if (text) drafts.push({ marker: "\u276F", text });
        }
      }
    }
  } else if (rec.type === "assistant" && Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const b = block;
      if (b.type === "text" && typeof b.text === "string") {
        const text = tidy(b.text);
        if (text) drafts.push({ marker: "\u23FA", text });
      } else if (b.type === "tool_use" && typeof b.name === "string") {
        const diff = diffOfToolUse(b.name, b.input, agent, ts);
        const draft = { marker: "\u23FA", text: describeTool(b.name, b.input) };
        if (diff) draft.diff = diff;
        drafts.push(draft);
      }
    }
  }
  return { ts, drafts };
}
function toTranscriptLines(rec, agent = "") {
  const built = draftsOf(rec, agent);
  if (!built) return [];
  return built.drafts.map((draft, i) => ({
    id: `${rec.uuid}#${i}`,
    marker: draft.marker,
    text: capText(draft.text),
    ts: built.ts,
    ...draft.diff ? { diff: draft.diff } : {},
    ...draft.sender ? { sender: draft.sender } : {}
  }));
}
function fullLineText(rec, index) {
  return draftsOf(rec)?.drafts[index]?.text;
}
function currentToolOf(rec) {
  const content = rec.message?.content;
  if (rec.type !== "assistant" || !Array.isArray(content)) return void 0;
  let found;
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block;
    if (b.type === "tool_use" && typeof b.name === "string") found = describeTool(b.name, b.input);
  }
  return found;
}

// src/shared/status.ts
var AGENT_STALE_MS = 30 * 60 * 1e3;
var LOG_CLOCK_SKEW_MS = 5 * 60 * 1e3;
function isWallClockLog(mtimeMs, lastRecordTs) {
  if (mtimeMs === void 0 || lastRecordTs <= 0) return false;
  return Math.abs(mtimeMs - lastRecordTs) <= LOG_CLOCK_SKEW_MS;
}
function deriveTaskState(raw, task, agents) {
  if (raw === "completed") return "completed";
  const owner = task.owner ? agents.find((a) => a.name === task.owner) : void 0;
  if (owner?.status === "plan_pending") return "plan_pending";
  if (owner?.status === "failed") return "failed";
  if (owner?.status === "blocked") return "blocked";
  if (raw === "pending" && task.blockedBy.length > 0) return "blocked";
  return raw;
}

// src/server/project.ts
var PROJECTED_TRANSCRIPT_LINES = 60;
function lastAssistantModel(records) {
  for (let i = records.length - 1; i >= 0; i--) {
    const m = records[i].message?.model;
    if (records[i].type === "assistant" && m) return m;
  }
  return void 0;
}
function memoisable(rec) {
  return rec !== null && typeof rec === "object";
}
var lineMemo = /* @__PURE__ */ new WeakMap();
function linesOf(rec, agent) {
  if (!memoisable(rec)) return toTranscriptLines(rec, agent);
  const byAgent = lineMemo.get(rec) ?? /* @__PURE__ */ new Map();
  let lines = byAgent.get(agent);
  if (!lines) {
    lines = toTranscriptLines(rec, agent);
    byAgent.set(agent, lines);
    lineMemo.set(rec, byAgent);
  }
  return lines;
}
var NO_TOOL = /* @__PURE__ */ Symbol("no tool");
var toolMemo = /* @__PURE__ */ new WeakMap();
function toolOf(rec) {
  if (!memoisable(rec)) return currentToolOf(rec);
  const hit = toolMemo.get(rec);
  if (hit !== void 0) return hit === NO_TOOL ? void 0 : hit;
  const tool = currentToolOf(rec);
  toolMemo.set(rec, tool ?? NO_TOOL);
  return tool;
}
var spawnMemo = /* @__PURE__ */ new WeakMap();
function spawnEventsFor(rec) {
  if (!memoisable(rec)) return spawnEventsOf(rec);
  let events = spawnMemo.get(rec);
  if (events === void 0) {
    events = spawnEventsOf(rec);
    spawnMemo.set(rec, events);
  }
  return events;
}
function transcriptHistory(events, agent) {
  const records = [];
  const seen = /* @__PURE__ */ new Set();
  for (const ev of events) {
    if (ev.kind !== "transcript") continue;
    const p = ev.payload;
    if (p.agent !== agent) continue;
    if (p.fromStart) {
      records.length = 0;
      seen.clear();
    }
    for (const rec of p.records) {
      const key = rec.uuid ?? "";
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      records.push(rec);
    }
  }
  const lines = [];
  for (const rec of records) lines.push(...linesOf(rec, agent));
  return lines;
}
function transcriptLineText(events, agent, id) {
  const hash = id.lastIndexOf("#");
  if (hash <= 0) return void 0;
  const uuid = id.slice(0, hash);
  const suffix = id.slice(hash + 1);
  if (!/^\d+$/.test(suffix)) return void 0;
  const index = Number(suffix);
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.kind !== "transcript") continue;
    const p = ev.payload;
    if (p.agent !== agent) continue;
    for (const rec of p.records) {
      if (rec.uuid !== uuid) continue;
      return fullLineText(rec, index);
    }
  }
  return void 0;
}
function project(events, readOnly, now = Date.now()) {
  let config = null;
  let sidecars = [];
  let branch;
  let sessionName;
  let rateLimits;
  const records = /* @__PURE__ */ new Map();
  const seenRecords = /* @__PURE__ */ new Map();
  const tasksRaw = /* @__PURE__ */ new Map();
  const unread = /* @__PURE__ */ new Map();
  const substatus = /* @__PURE__ */ new Map();
  const currentTool = /* @__PURE__ */ new Map();
  const errors = /* @__PURE__ */ new Map();
  const lastActivity = /* @__PURE__ */ new Map();
  const logClock = /* @__PURE__ */ new Map();
  const needsYou = /* @__PURE__ */ new Map();
  const usageTotals = /* @__PURE__ */ new Map();
  const spawnFolds = /* @__PURE__ */ new Map();
  const subagentFacts = /* @__PURE__ */ new Map();
  let mail = [];
  const bump = (agent, ts) => {
    if (ts > (lastActivity.get(agent) ?? -1)) lastActivity.set(agent, ts);
  };
  for (const ev of events) {
    switch (ev.kind) {
      case "roster": {
        const p = ev.payload;
        if (p.config) config = p.config;
        if (p.sidecars && p.sidecars.length > 0) sidecars = p.sidecars;
        break;
      }
      case "transcript": {
        const p = ev.payload;
        if (p.totals) usageTotals.set(p.agent, p.totals);
        if (p.mtimeMs !== void 0) logClock.set(p.agent, p.mtimeMs);
        if (p.fromStart) {
          records.set(p.agent, []);
          seenRecords.set(p.agent, /* @__PURE__ */ new Set());
          spawnFolds.set(p.agent, emptySubagentFold());
        }
        const list = records.get(p.agent) ?? [];
        const seen = seenRecords.get(p.agent) ?? /* @__PURE__ */ new Set();
        const spawns = spawnFolds.get(p.agent) ?? emptySubagentFold();
        for (const rec of p.records) {
          const key = rec.uuid ?? "";
          if (key && seen.has(key)) continue;
          if (key) seen.add(key);
          list.push(rec);
          const tool = toolOf(rec);
          if (tool) currentTool.set(p.agent, tool);
          else if (rec.type === "user" && rec.toolUseResult !== void 0) {
            currentTool.set(p.agent, void 0);
          }
          if (rec.type === "assistant") {
            if (rec.isApiErrorMessage) {
              errors.set(p.agent, linesOf(rec, p.agent)[0]?.text ?? "api error");
            } else {
              errors.delete(p.agent);
            }
          }
          applySpawnEvents(spawns, spawnEventsFor(rec));
          const ts = rec.timestamp ? Date.parse(rec.timestamp) : NaN;
          if (!Number.isNaN(ts)) bump(p.agent, ts);
        }
        records.set(p.agent, list);
        seenRecords.set(p.agent, seen);
        spawnFolds.set(p.agent, spawns);
        break;
      }
      case "subagent": {
        const p = ev.payload;
        subagentFacts.set(p.toolUseId, {
          agentId: p.agentId,
          meta: p.meta,
          digest: p.digest
        });
        break;
      }
      case "task": {
        const p = ev.payload;
        tasksRaw.set(p.id, p);
        break;
      }
      case "mail": {
        const p = ev.payload;
        if (p.source === "inbox") {
          mail = mergeMail(mail, p.entries.map((e) => parseInboxEntry(e, p.to)));
          unread.set(p.to, p.entries.filter((e) => e.read === false).length);
        } else {
          mail = mergeMail(mail, parseTeammateFrames(p.text, p.deliveredAt, p.to));
        }
        break;
      }
      case "hook": {
        const p = ev.payload;
        if (p.event === "PreToolUse" && p.toolName) currentTool.set(p.agent, p.toolName);
        if (p.event === "PostToolUse") currentTool.set(p.agent, void 0);
        if (p.error) errors.set(p.agent, p.error);
        bump(p.agent, ev.ts);
        break;
      }
      case "statusline": {
        const p = ev.payload;
        if (p.branch) branch = p.branch;
        if (p.sessionName) sessionName = p.sessionName;
        if (p.fiveHourPct !== void 0 || p.sevenDayPct !== void 0) {
          rateLimits = {
            fiveHourPct: p.fiveHourPct ?? 0,
            sevenDayPct: p.sevenDayPct ?? 0,
            resetsAt: p.resetsAt
          };
        }
        break;
      }
      case "substatus": {
        const p = ev.payload;
        substatus.set(p.agent, { ...substatus.get(p.agent), ...p });
        break;
      }
      case "needsyou": {
        const item = ev.payload;
        needsYou.set(item.id, item);
        break;
      }
      case "needsyou-resolved": {
        needsYou.delete(ev.payload.id);
        break;
      }
    }
  }
  const lastIdle = /* @__PURE__ */ new Map();
  for (const m of mail) {
    if (m.protocol?.type === "idle_notification" && m.ts > (lastIdle.get(m.from) ?? -1)) {
      lastIdle.set(m.from, m.ts);
    }
  }
  let latestActivity = -1;
  for (const ts of lastActivity.values()) if (ts > latestActivity) latestActivity = ts;
  const cards = [...needsYou.values()].filter(
    (c) => c.expiresAt === void 0 || c.expiresAt > Date.now()
  );
  let totalTokens = 0;
  const liveMembers = config ? new Set(config.members.map((m) => m.name)) : null;
  const roster = buildRoster(config, sidecars);
  const soloLead = roster.length === 0 ? [...records.keys()][0] : void 0;
  if (soloLead !== void 0) {
    roster.push({
      name: soloLead,
      agentId: soloLead,
      isLead: true,
      agentType: "",
      role: "",
      joinedAt: 0
    });
  }
  const agents = roster.map((id) => {
    const recs = records.get(id.name) ?? [];
    const sub = substatus.get(id.name);
    const resolved = resolveModel(lastAssistantModel(recs) ?? sub?.model ?? id.rawModel);
    const carried = usageTotals.get(id.name);
    const usage = carried ? [] : dedupeUsage(usageRecordsOf(recs));
    totalTokens += carried ? carried.tokens : tokensOf(usage);
    const tail = [];
    let have = 0;
    for (let i = recs.length - 1; i >= 0 && have < PROJECTED_TRANSCRIPT_LINES; i--) {
      const some = linesOf(recs[i], id.name);
      if (some.length === 0) continue;
      tail.push(some);
      have += some.length;
    }
    const lines = [];
    for (let i = tail.length - 1; i >= 0; i--) for (const line of tail[i]) lines.push(line);
    let status = "working";
    if (id.name !== soloLead && (!liveMembers || !liveMembers.has(id.name))) status = "departed";
    else if (errors.has(id.name)) status = "failed";
    else if (cards.some((c) => c.agent === id.name && c.kind === "plan")) status = "plan_pending";
    else {
      const act = lastActivity.get(id.name) ?? -1;
      const idle = lastIdle.get(id.name) ?? -1;
      if (act < 0 || idle >= act) status = "idle";
      else if (latestActivity - act > AGENT_STALE_MS) status = "departed";
      else if (isWallClockLog(logClock.get(id.name), act) && now - act > AGENT_STALE_MS) {
        status = "idle";
      }
    }
    return {
      name: id.name,
      agentId: id.agentId,
      isLead: id.isLead,
      agentType: id.agentType,
      model: resolved.canonical,
      role: id.role,
      color: id.color,
      status,
      currentTool: currentTool.get(id.name),
      contextTokens: sub?.tokenCount ?? contextOccupancy(recs),
      contextLimit: resolved.window,
      compactAt: resolved.compactAt,
      costUsd: carried ? carried.costUsd : totalCost(usage),
      tokenSplit: carried ? carried.split : splitTok(usage),
      startedAt: id.joinedAt,
      transcript: lines.slice(-PROJECTED_TRANSCRIPT_LINES),
      unread: unread.get(id.name) ?? 0,
      error: errors.get(id.name)
    };
  });
  const tasks = [...tasksRaw.values()].map((t) => {
    const blockedBy = t.blockedBy ?? [];
    const openBlockedBy = blockedBy.filter((id) => tasksRaw.get(id)?.status !== "completed");
    return {
      id: t.id,
      subject: t.subject,
      description: t.description,
      activeForm: t.activeForm,
      owner: t.owner,
      state: deriveTaskState(t.status, { owner: t.owner, blockedBy: openBlockedBy }, agents),
      blocks: t.blocks ?? [],
      blockedBy,
      openBlockedBy,
      metadata: t.metadata
    };
  });
  for (const agent of agents) {
    if (agent.status !== "working") continue;
    const owned = tasks.filter((t) => t.owner === agent.name);
    if (owned.some((t) => t.state === "in_progress")) continue;
    if (owned.some((t) => t.state === "blocked")) agent.status = "blocked";
  }
  const subagents = buildSubagentTree(
    agents.map((a) => ({ agent: a.name, spawns: spawnFolds.get(a.name)?.spawns ?? [] })),
    subagentFacts
  );
  return {
    teamName: config?.name ?? "",
    sessionName,
    leadSessionId: config?.leadSessionId ?? "",
    branch,
    startedAt: config?.createdAt ?? 0,
    totalTokens,
    totalCostUsd: agents.reduce((sum, a) => sum + a.costUsd, 0),
    rateLimits,
    agents,
    tasks,
    mail,
    needsYou: cards,
    readOnly,
    ...Object.keys(subagents).length > 0 ? { subagents } : {}
  };
}

// src/server/ingest/files.ts
import { promises as fs4 } from "node:fs";
import path6 from "node:path";

// src/server/watch/tail.ts
import { promises as fs2 } from "node:fs";
import path3 from "node:path";

// src/server/watch/root.ts
import { watch } from "node:fs";
function watchRoot(root, onEvent) {
  let watcher;
  try {
    watcher = watch(root, { recursive: true }, (eventType, filename) => {
      if (eventType !== "rename" && eventType !== "change") return;
      if (!filename) return;
      onEvent(filename.toString());
    });
  } catch (err) {
    if (err.code === "ENOENT") {
      logInfo(`no ${root} yet \u2014 the reconciliation sweep will pick it up if it appears`);
    } else {
      logError(`cannot watch ${root} \u2014 falling back to the reconciliation sweep`, err);
    }
    return { close() {
    } };
  }
  debug("watchRoot", `watching ${root}`);
  watcher.on("error", (err) => logError(`watcher for ${root} failed`, err));
  return {
    close() {
      watcher.close();
    }
  };
}

// src/server/watch/tail.ts
function emptyTailState() {
  return { inode: 0, offset: 0, partial: "" };
}
async function drain(filePath, state) {
  let st;
  try {
    st = await fs2.stat(filePath);
  } catch {
    return { lines: [], state, fromStart: false };
  }
  let next = state;
  if (st.ino !== state.inode || st.size < state.offset) {
    next = { inode: st.ino, offset: 0, partial: "" };
  }
  const fromStart = next.offset === 0;
  const mtimeMs = st.mtimeMs;
  const length = st.size - next.offset;
  if (length <= 0) return { lines: [], state: next, fromStart: false, mtimeMs };
  const buf = Buffer.alloc(length);
  let read = 0;
  const fh = await fs2.open(filePath, "r");
  try {
    while (read < length) {
      const r = await fh.read(buf, read, length - read, next.offset + read);
      if (r.bytesRead === 0) break;
      read += r.bytesRead;
    }
  } finally {
    await fh.close();
  }
  const chunk = next.partial + buf.subarray(0, read).toString("utf8");
  const cut = chunk.lastIndexOf("\n");
  const offset = next.offset + read;
  if (cut === -1) {
    return { lines: [], state: { inode: next.inode, offset, partial: chunk }, fromStart, mtimeMs };
  }
  const lines = chunk.slice(0, cut).split("\n").filter((l) => l.length > 0);
  return {
    lines,
    state: { inode: next.inode, offset, partial: chunk.slice(cut + 1) },
    fromStart,
    mtimeMs
  };
}
function watchAppendOnly(root, onLines) {
  const states = /* @__PURE__ */ new Map();
  const queues = /* @__PURE__ */ new Map();
  const queued = /* @__PURE__ */ new Set();
  let closed = false;
  const pump = (file) => {
    const tail = queues.get(file);
    if (tail && queued.has(file)) return tail;
    if (tail) queued.add(file);
    const next = (tail ?? Promise.resolve()).then(async () => {
      queued.delete(file);
      if (closed) return;
      const out = await drain(file, states.get(file) ?? emptyTailState());
      states.set(file, out.state);
      if (out.lines.length > 0) onLines(file, out.lines, out.fromStart, out.mtimeMs);
    }).catch((err) => logError(`tail ${file}`, err));
    queues.set(file, next);
    return next;
  };
  const watcher = watchRoot(root, (filename) => {
    if (!filename.endsWith(".jsonl")) return;
    void pump(path3.join(root, filename));
  });
  const forget = (file) => {
    const next = (queues.get(file) ?? Promise.resolve()).then(() => {
      states.delete(file);
    });
    queues.set(file, next);
    return next;
  };
  return {
    pump,
    forget,
    close() {
      closed = true;
      watcher.close();
    }
  };
}

// src/server/watch/jsonfile.ts
import { promises as fs3 } from "node:fs";
import path4 from "node:path";
var RETRY_DELAY_MS = 20;
var DEBOUNCE_MS = 15;
function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
async function readJsonSafe(filePath) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return JSON.parse(await fs3.readFile(filePath, "utf8"));
    } catch {
      if (attempt === 0) await delay(RETRY_DELAY_MS);
    }
  }
  return null;
}
function watchJsonTree(root, onChange) {
  const timers = /* @__PURE__ */ new Map();
  let closed = false;
  const watcher = watchRoot(root, (filename) => {
    if (!filename.endsWith(".json")) return;
    const full = path4.join(root, filename);
    const pending = timers.get(full);
    if (pending) clearTimeout(pending);
    timers.set(
      full,
      setTimeout(() => {
        timers.delete(full);
        if (!closed) onChange(full);
      }, DEBOUNCE_MS)
    );
  });
  return {
    close() {
      closed = true;
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      watcher.close();
    }
  };
}

// src/server/ingest/workflow-agents.ts
import path5 from "node:path";

// src/shared/workflow-usage.ts
function emptyWorkflowUsageFold() {
  return { agents: /* @__PURE__ */ new Map() };
}
var WORKFLOW_AGENT_FILE = /^agent-(a[0-9a-f]{16})\.jsonl$/;
function workflowAgentIdOf(basename) {
  return WORKFLOW_AGENT_FILE.exec(basename)?.[1] ?? null;
}
function foldWorkflowAgentRecords(fold, agentId, records) {
  let turns = fold.agents.get(agentId);
  if (!turns) {
    turns = /* @__PURE__ */ new Map();
    fold.agents.set(agentId, turns);
  }
  for (const rec of records) {
    if (rec.type !== "assistant" || rec.isApiErrorMessage === true) continue;
    const usage = rec.message?.usage;
    if (!usage) continue;
    const ts = rec.timestamp ? Date.parse(rec.timestamp) : NaN;
    if (Number.isNaN(ts)) continue;
    const messageId = rec.message?.id ?? rec.uuid ?? "";
    if (!messageId) continue;
    const best = turns.get(messageId);
    if (best && best.usage.output_tokens >= (usage.output_tokens ?? 0)) continue;
    turns.set(messageId, { ts, model: rec.message?.model ?? "", usage });
  }
}
var recordsOf2 = (turns) => [...turns].map(([messageId, t]) => ({ messageId, model: t.model, usage: t.usage }));
var TOTAL = (split) => split.in + split.out + split.cacheWrite + split.cacheRead;
function addSplit(into, from) {
  into.in += from.in;
  into.out += from.out;
  into.cacheWrite += from.cacheWrite;
  into.cacheWrite1h += from.cacheWrite1h;
  into.cacheRead += from.cacheRead;
}
var emptySplit = () => ({
  in: 0,
  out: 0,
  cacheWrite: 0,
  cacheWrite1h: 0,
  cacheRead: 0
});
function burnOf(turns) {
  const sorted = [...turns].sort((a, b) => a.ts - b.ts);
  if (sorted.length === 0) return { startedAt: 0, stepMs: 1, cumulative: [] };
  const startedAt = sorted[0]?.ts ?? 0;
  const endedAt = sorted[sorted.length - 1]?.ts ?? startedAt;
  const span = endedAt - startedAt;
  const stepMs = span <= 0 ? 1 : Math.ceil(span / WORKFLOW_BURN_SAMPLES);
  const buckets = span <= 0 ? 1 : Math.min(WORKFLOW_BURN_SAMPLES, Math.floor(span / stepMs) + 1);
  const perBucket = new Array(buckets).fill(0);
  for (const turn of sorted) {
    const at = Math.min(buckets - 1, Math.floor((turn.ts - startedAt) / stepMs));
    perBucket[at] += TOTAL(splitTok([{ messageId: "", model: turn.model, usage: turn.usage }]));
  }
  const cumulative = [];
  let running = 0;
  for (const tokens of perBucket) {
    running += tokens;
    cumulative.push(running);
  }
  return { startedAt, stepMs, cumulative };
}
function workflowUsageOf(runId, fold) {
  const agents = [];
  const split = emptySplit();
  const turns = [];
  for (const [agentId, byMessage] of fold.agents) {
    if (byMessage.size === 0) continue;
    const rows = recordsOf2(byMessage);
    const own = splitTok(rows);
    addSplit(split, own);
    for (const turn of byMessage.values()) turns.push(turn);
    const model = [...byMessage.values()].sort((a, b) => a.ts - b.ts).at(-1)?.model;
    agents.push({ agentId, split: own, ...model ? { model } : {} });
  }
  return { runId, agents, split, burn: burnOf(turns) };
}
function attachWorkflowUsage(agents, payload) {
  const byId = new Map(payload.agents.map((a) => [a.agentId, a]));
  const merged = agents.map((agent) => {
    const own = byId.get(agent.agentId);
    if (!own) return agent;
    return {
      ...agent,
      tokenSplit: own.split,
      // The snapshot's model wins when there is one: it is what the runtime
      // resolved, where the transcript reports what a given turn ran on.
      ...agent.model || !own.model ? {} : { model: own.model }
    };
  });
  const perPhase = /* @__PURE__ */ new Map();
  for (const agent of agents) {
    const own = byId.get(agent.agentId);
    if (!own || agent.phaseIndex === void 0) continue;
    const into = perPhase.get(agent.phaseIndex) ?? emptySplit();
    addSplit(into, own.split);
    perPhase.set(agent.phaseIndex, into);
  }
  return {
    usage: {
      split: payload.split,
      byPhase: [...perPhase].sort((a, b) => a[0] - b[0]).map(([phaseIndex, split]) => ({ phaseIndex, split })),
      burn: payload.burn,
      agentsMeasured: payload.agents.length
    },
    agents: merged
  };
}

// src/server/ingest/workflow-agents.ts
var RUN_ID = /^wf_.+$/;
function workflowAgentClaimOf(file) {
  const agentId = workflowAgentIdOf(path5.basename(file));
  if (!agentId) return null;
  const dir = path5.dirname(file);
  const runId = path5.basename(dir);
  if (!RUN_ID.test(runId)) return null;
  const up = (n) => {
    let at = dir;
    for (let i = 0; i < n; i++) at = path5.dirname(at);
    return path5.basename(at);
  };
  if (up(1) !== "workflows" || up(2) !== "subagents") return null;
  return { runId, sessionId: up(3), agentId };
}
function createWorkflowUsageIngest(store, inScope) {
  const runs = /* @__PURE__ */ new Map();
  const publish = (runId) => {
    const held = runs.get(runId);
    if (!held || !inScope(held.sessionId)) return;
    const payload = workflowUsageOf(runId, held.fold);
    if (payload.agents.length === 0) return;
    store.append("workflow-usage", payload);
  };
  return {
    handle(file, lines, fromStart) {
      const claim = workflowAgentClaimOf(file);
      if (!claim) return false;
      const records = [];
      for (const line of lines) {
        const rec = parseLine(line);
        if (rec) records.push(rec);
      }
      if (records.length === 0) return true;
      let held = runs.get(claim.runId);
      if (!held) {
        held = { sessionId: claim.sessionId, fold: emptyWorkflowUsageFold() };
        runs.set(claim.runId, held);
      }
      if (fromStart) held.fold.agents.delete(claim.agentId);
      foldWorkflowAgentRecords(held.fold, claim.agentId, records);
      publish(claim.runId);
      return true;
    },
    flush() {
      for (const runId of runs.keys()) publish(runId);
    }
  };
}

// src/server/workflow.ts
var bagOf = (v) => v !== null && typeof v === "object" ? v : {};
var str2 = (v) => typeof v === "string" && v ? v : void 0;
var num = (v) => typeof v === "number" && Number.isFinite(v) ? v : void 0;
var arr = (v) => Array.isArray(v) ? v : [];
function resultText2(v) {
  if (typeof v === "string") return v;
  if (v === null || v === void 0) return void 0;
  try {
    return JSON.stringify(v);
  } catch {
    return void 0;
  }
}
var RUN_STATUS = /* @__PURE__ */ new Set(["completed", "killed", "failed", "running"]);
function agentStateOf(rec) {
  if (rec.cached === true) return "cache";
  switch (str2(rec.state)) {
    case "done":
      return "done";
    case "progress":
      return "run";
    // One emitter covers both "queued for a concurrency slot" and "just
    // spawned"; `startedAt` is the only thing that separates them.
    case "start":
      return num(rec.startedAt) === void 0 ? "wait" : "run";
    // `error` is the runtime's one bucket for three different things: the
    // operator skipped it, the classifier refused it, or it threw. Only the
    // last is a failure, and it is the one the console must not bury.
    case "error":
      if (rec.skipped === true) return "null";
      return rec.blocked === true ? "block" : "fail";
    default:
      return "null";
  }
}
function agentOf(rec) {
  const agentId = str2(rec.agentId);
  if (!agentId) return null;
  return {
    agentId,
    state: agentStateOf(rec),
    ...opt("label", str2(rec.label)),
    ...opt("model", str2(rec.model)),
    ...opt("queuedAt", num(rec.queuedAt)),
    ...opt("tokens", num(rec.tokens)),
    ...opt("toolCalls", num(rec.toolCalls)),
    ...opt("attempt", num(rec.attempt)),
    ...opt("prompt", str2(rec.promptPreview)),
    ...opt("phaseIndex", num(rec.phaseIndex)),
    ...opt("phaseTitle", str2(rec.phaseTitle)),
    ...opt("startedAt", num(rec.startedAt)),
    ...opt("durationMs", num(rec.durationMs)),
    ...opt("result", str2(rec.resultPreview)),
    ...opt("lastTool", str2(rec.lastToolName)),
    ...opt("error", str2(rec.error)),
    ...opt("isolation", str2(rec.isolation)),
    ...opt("agentType", str2(rec.agentType))
  };
}
function opt(key, value) {
  return value === void 0 ? {} : { [key]: value };
}
function phasesOf(snapshot, progress) {
  const declared = arr(snapshot.phases).map(bagOf);
  return progress.filter((rec) => rec.type === "workflow_phase").map((rec, i) => {
    const title = str2(rec.title) ?? str2(declared[i]?.title) ?? "";
    return { index: num(rec.index) ?? i + 1, title, ...opt("detail", str2(declared[i]?.detail)) };
  });
}
function parseWorkflowJournal(runId, lines) {
  const byId = /* @__PURE__ */ new Map();
  for (const line of lines) {
    if (!line.trim()) continue;
    let rec;
    try {
      rec = bagOf(JSON.parse(line));
    } catch {
      continue;
    }
    const agentId = str2(rec.agentId);
    if (!agentId) continue;
    const existing = byId.get(agentId);
    if (rec.type === "result") {
      byId.set(agentId, { agentId, state: "done", ...opt("result", resultText2(rec.result)) });
    } else if (rec.type === "started" && !existing) {
      byId.set(agentId, { agentId, state: "run" });
    }
  }
  return {
    runId,
    status: "running",
    live: true,
    agents: [...byId.values()],
    phases: [],
    logs: []
  };
}
function parseWorkflowRun(raw) {
  const snapshot = bagOf(raw);
  const runId = str2(snapshot.runId);
  const name = str2(snapshot.workflowName);
  if (!runId || !name) return null;
  const progress = arr(snapshot.workflowProgress).map(bagOf);
  const rawStatus = str2(snapshot.status);
  return {
    runId,
    name,
    status: rawStatus && RUN_STATUS.has(rawStatus) ? rawStatus : "completed",
    startedAt: num(snapshot.startTime) ?? 0,
    phases: phasesOf(snapshot, progress),
    agents: progress.filter((rec) => rec.type === "workflow_agent").map(agentOf).filter((a) => a !== null),
    logs: arr(snapshot.logs).filter((l) => typeof l === "string"),
    live: false,
    ...opt("taskId", str2(snapshot.taskId)),
    ...opt("description", str2(snapshot.summary)),
    ...opt("scriptPath", str2(snapshot.scriptPath)),
    ...opt("script", str2(snapshot.script)),
    ...opt("durationMs", num(snapshot.durationMs)),
    ...opt("agentCount", num(snapshot.agentCount)),
    ...opt("totalTokens", num(snapshot.totalTokens)),
    ...opt("totalToolCalls", num(snapshot.totalToolCalls)),
    ...opt("defaultModel", str2(snapshot.defaultModel)),
    ...opt("result", str2(snapshot.result)),
    ...opt("error", str2(snapshot.error))
  };
}
function foldWorkflows(events) {
  const byRun = /* @__PURE__ */ new Map();
  const usage = /* @__PURE__ */ new Map();
  for (const event of events) {
    if (event.kind === "workflow-usage") {
      const payload = event.payload;
      if (payload?.runId) usage.set(payload.runId, payload);
      continue;
    }
    if (event.kind !== "workflow") continue;
    const run2 = event.payload;
    const runId = run2?.runId;
    if (!runId) continue;
    if (run2.live && byRun.get(runId)?.live === false) continue;
    byRun.set(runId, run2);
  }
  const runs = [...byRun.values()].map((run2) => {
    const measured = usage.get(run2.runId);
    if (!measured || measured.agents.length === 0) return run2;
    const { usage: rollup, agents } = attachWorkflowUsage(run2.agents, measured);
    return { ...run2, agents, usage: rollup };
  });
  return runs.sort((a, b) => (b.startedAt ?? -1) - (a.startedAt ?? -1));
}
function modeOf(teamAgents, runs) {
  return teamAgents < 2 && runs.length > 0 ? "workflow" : "team";
}
function leanRun(run2) {
  const { script: _script, ...lean } = run2;
  return lean;
}

// src/server/ingest/files.ts
var DEFAULT_SWEEP_MS = 5e3;
var TAIL_POLL_MS = 250;
var INGEST_BATCH_RECORDS = 200;
var PENDING_RECORDS = 6e3;
var SUBAGENT_FILE = /^agent-a(.+)-[0-9a-f]{16}\.jsonl$/;
var SUBAGENT_TRANSCRIPT = /^agent-(a(?:.+-)?[0-9a-f]{16})\.jsonl$/;
var WORKFLOW_SEGMENT = `${path6.sep}workflows${path6.sep}`;
function chainHas(chain, sessionId) {
  if (!chain) return false;
  return typeof chain === "string" ? chain === sessionId : chain.has(sessionId);
}
function chainKnown(chain) {
  if (!chain) return false;
  return typeof chain === "string" || chain.size > 0;
}
function claimOfTranscript(file, leadSessionId, leadName) {
  if (file.includes(WORKFLOW_SEGMENT)) return null;
  const base = path6.basename(file);
  const known = chainKnown(leadSessionId);
  if (known && base.endsWith(".jsonl") && chainHas(leadSessionId, base.slice(0, -".jsonl".length))) {
    return { agent: leadName, scoped: true };
  }
  const m = SUBAGENT_FILE.exec(base);
  if (!m) return null;
  if (!known) return { agent: m[1], scoped: false };
  if (!chainHas(leadSessionId, path6.basename(path6.dirname(path6.dirname(file))))) return null;
  return { agent: m[1], scoped: true };
}
function subagentIdOf(file, leadSessionId) {
  if (file.includes(WORKFLOW_SEGMENT)) return null;
  const m = SUBAGENT_TRANSCRIPT.exec(path6.basename(file));
  if (!m) return null;
  if (!chainHas(leadSessionId, path6.basename(path6.dirname(path6.dirname(file))))) return null;
  return m[1];
}
var RUN_ID2 = /^wf_.+$/;
function isWorkflowPath(file) {
  const base = path6.basename(file);
  const dir = path6.dirname(file);
  if (base === "journal.jsonl") return path6.basename(path6.dirname(dir)) === "workflows";
  return base.endsWith(".json") && path6.basename(dir) === "workflows" && RUN_ID2.test(base.slice(0, -".json".length));
}
function workflowClaimOf(file, leadSessionId) {
  const base = path6.basename(file);
  const dir = path6.dirname(file);
  const up = (n) => {
    let at = dir;
    for (let i = 0; i < n; i++) at = path6.dirname(at);
    return path6.basename(at);
  };
  if (base === "journal.jsonl" && up(1) === "workflows" && up(2) === "subagents") {
    const runId = path6.basename(dir);
    if (!RUN_ID2.test(runId)) return null;
    const sessionId = up(3);
    return chainHas(leadSessionId, sessionId) ? { kind: "journal", runId, sessionId } : null;
  }
  if (base.endsWith(".json") && path6.basename(dir) === "workflows" && up(1) !== "subagents") {
    const runId = base.slice(0, -".json".length);
    if (!RUN_ID2.test(runId)) return null;
    const sessionId = up(1);
    return chainHas(leadSessionId, sessionId) ? { kind: "snapshot", runId, sessionId } : null;
  }
  return null;
}
async function walk(root) {
  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = await fs4.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path6.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile()) out.push(full);
    }
  }
  return out.sort(
    (a, b) => (path6.basename(a) === "config.json" ? 0 : 1) - (path6.basename(b) === "config.json" ? 0 : 1) || a.localeCompare(b)
  );
}
var FIRST_LINE_BYTES = 64 * 1024;
async function readFirstLine(file) {
  const fh = await fs4.open(file, "r");
  try {
    const buf = Buffer.alloc(FIRST_LINE_BYTES);
    const { bytesRead } = await fh.read(buf, 0, FIRST_LINE_BYTES, 0);
    const text = buf.subarray(0, bytesRead).toString("utf8");
    const nl = text.indexOf("\n");
    return nl === -1 ? text : text.slice(0, nl);
  } finally {
    await fh.close();
  }
}
function startFileIngest(store, config) {
  const { paths } = config;
  const leadName = config.leadName ?? "team-lead";
  let teamName = config.teamName;
  let leadSessionId = config.leadSessionId;
  const chain = new Set(leadSessionId ? [leadSessionId] : []);
  let leadProjectDir = null;
  const forkParent = /* @__PURE__ */ new Map();
  const forkChecked = /* @__PURE__ */ new Set();
  let lastConfig = null;
  const sidecars = /* @__PURE__ */ new Map();
  const ownedFiles = /* @__PURE__ */ new Map();
  const marks = /* @__PURE__ */ new Map();
  const unresolvedSidecars = /* @__PURE__ */ new Map();
  const subagentOf = /* @__PURE__ */ new Map();
  const subagentFolds = /* @__PURE__ */ new Map();
  const workflowUsage = createWorkflowUsageIngest(store, (sessionId) => chainHas(chain, sessionId));
  const unresolvedWorkflows = /* @__PURE__ */ new Set();
  const transcriptPaths = /* @__PURE__ */ new Map();
  const notePath = (agent, file) => {
    const files = transcriptPaths.get(agent) ?? /* @__PURE__ */ new Set();
    files.add(file);
    transcriptPaths.set(agent, files);
  };
  const own = (agent, file) => {
    const files = ownedFiles.get(agent) ?? /* @__PURE__ */ new Set();
    files.add(file);
    ownedFiles.set(agent, files);
    notePath(agent, file);
  };
  let closed = false;
  const mark = async (file) => {
    try {
      marks.set(file, (await fs4.stat(file)).mtimeMs);
    } catch {
    }
  };
  const settle = (file) => (p) => p.then(() => mark(file)).catch((err) => logError(`ingest ${file}`, err));
  const appendRoster = () => {
    store.append("roster", {
      config: lastConfig,
      sidecars: [...sidecars].map(([transcriptPath, meta]) => ({ meta, transcriptPath }))
    });
  };
  const pending = /* @__PURE__ */ new Map();
  const PENDING_CAP = 500;
  let pendingRecords = 0;
  const dropPending = (file) => {
    const buf = pending.get(file);
    if (!buf) return;
    pendingRecords -= buf.records.length;
    pending.delete(file);
  };
  const evictPending = () => {
    while (pendingRecords > PENDING_RECORDS) {
      const oldest = pending.keys().next();
      if (oldest.done) return;
      dropPending(oldest.value);
    }
  };
  const usageLedger = /* @__PURE__ */ new Map();
  const ledgerFiles = /* @__PURE__ */ new Map();
  const noteUsage = (file, agent, records) => {
    const ledger = usageLedger.get(file) ?? /* @__PURE__ */ new Map();
    for (const u of usageRecordsOf(records)) {
      const best = ledger.get(u.messageId);
      if (!best || u.usage.output_tokens > best.usage.output_tokens) ledger.set(u.messageId, u);
    }
    usageLedger.set(file, ledger);
    const files = ledgerFiles.get(agent) ?? /* @__PURE__ */ new Set();
    files.add(file);
    ledgerFiles.set(agent, files);
  };
  const totalsFor = (agent) => {
    const candidates = [...ledgerFiles.get(agent) ?? []];
    const owned = ownedFiles.get(agent);
    const attributable = candidates.filter((f) => owned?.has(f) === true);
    const files = attributable.length > 0 ? attributable : candidates;
    let all;
    if (files.length === 1) {
      all = [...(usageLedger.get(files[0]) ?? /* @__PURE__ */ new Map()).values()];
    } else {
      const best = /* @__PURE__ */ new Map();
      for (const f of files) {
        for (const [id, u] of usageLedger.get(f) ?? []) {
          const prev = best.get(id);
          if (!prev || u.usage.output_tokens > prev.usage.output_tokens) best.set(id, u);
        }
      }
      all = [...best.values()];
    }
    return { costUsd: totalCost(all), tokens: tokensOf(all), split: splitTok(all) };
  };
  const transcriptOfSidecar = (file) => file.replace(/\.meta\.json$/, ".jsonl");
  const disowned = /* @__PURE__ */ new Set();
  const deferred = /* @__PURE__ */ new Set();
  const forget = (transcript) => {
    disowned.add(transcript);
    dropPending(transcript);
    usageLedger.delete(transcript);
    for (const files of ledgerFiles.values()) files.delete(transcript);
    for (const files of transcriptPaths.values()) files.delete(transcript);
  };
  const appendTranscript = (agent, records, fromStart, mtimeMs) => {
    const totals = totalsFor(agent);
    for (let i = 0; i < records.length; i += INGEST_BATCH_RECORDS) {
      const payload = {
        agent,
        records: records.slice(i, i + INGEST_BATCH_RECORDS)
      };
      if (fromStart && i === 0) payload.fromStart = true;
      if (i + INGEST_BATCH_RECORDS >= records.length) {
        payload.totals = totals;
        if (mtimeMs !== void 0) payload.mtimeMs = mtimeMs;
      }
      store.append("transcript", payload, agent);
    }
    appendDrainedMail(agent, records);
  };
  const appendDrainedMail = (agent, records) => {
    for (const rec of records) {
      if (rec.type !== "user") continue;
      const content = rec.message?.content;
      if (typeof content !== "string" || !content.includes("<teammate-message")) continue;
      const deliveredAt = rec.timestamp ? Date.parse(rec.timestamp) : NaN;
      if (Number.isNaN(deliveredAt)) continue;
      store.append("mail", { source: "transcript", to: agent, text: content, deliveredAt }, agent);
    }
  };
  const appendSubagent = (transcript, records, fromStart = false) => {
    const known = subagentOf.get(transcript);
    if (!known) return;
    let fold = subagentFolds.get(transcript);
    if (!fold || fromStart) {
      fold = emptySubagentFold();
      subagentFolds.set(transcript, fold);
    }
    if (records.length > 0) foldSubagentRecords(fold, records);
    const payload = {
      toolUseId: known.toolUseId,
      agentId: known.agentId,
      meta: {
        name: known.meta.name,
        agentType: known.meta.agentType,
        model: known.meta.model,
        description: known.meta.description
      },
      digest: digestOf(fold)
    };
    store.append("subagent", payload);
  };
  const adoptSubagent = (transcript, meta) => {
    const toolUseId = meta.toolUseId;
    if (!toolUseId) return;
    const agentId = subagentIdOf(transcript, chain);
    if (!agentId) return;
    const first = !subagentOf.has(transcript);
    subagentOf.set(transcript, { toolUseId, agentId, meta });
    if (!first) return;
    const buffered = pending.get(transcript)?.records ?? [];
    dropPending(transcript);
    appendSubagent(transcript, buffered);
    void transcripts.pump(transcript);
  };
  const handleSubagentLines = (transcript, lines, fromStart) => {
    const records = [];
    for (const l of lines) {
      const rec = parseLine(l);
      if (rec) records.push(rec);
    }
    if (records.length === 0) return;
    appendSubagent(transcript, records, fromStart);
  };
  const flushPending = (agent, transcript) => {
    const buf = pending.get(transcript);
    dropPending(transcript);
    if (buf && buf.records.length > 0) appendTranscript(agent, buf.records, false);
  };
  const handleLines = (file, lines, fromStart, mtimeMs) => {
    if (subagentOf.has(file)) {
      handleSubagentLines(file, lines, fromStart);
      return;
    }
    const claim = claimOfTranscript(file, chain, leadName);
    if (!claim) {
      deferred.add(file);
      return;
    }
    if (disowned.has(file)) return;
    const meta = sidecars.get(file);
    const agent = meta?.name ?? claim.agent;
    notePath(agent, file);
    const records = [];
    for (const l of lines) {
      const rec = parseLine(l);
      if (rec) records.push(rec);
    }
    if (records.length === 0) return;
    noteUsage(file, agent, records);
    const lead = claim.scoped && claim.agent === leadName;
    if (lead) own(leadName, file);
    if (meta || lead) {
      flushPending(agent, file);
      appendTranscript(agent, records, fromStart && (ownedFiles.get(agent)?.size ?? 1) <= 1, mtimeMs);
      return;
    }
    const buf = pending.get(file)?.records ?? [];
    dropPending(file);
    buf.push(...records);
    const kept = buf.slice(-PENDING_CAP);
    pending.set(file, { agent, records: kept });
    pendingRecords += kept.length;
    evictPending();
  };
  const readOwnInboxes = async () => {
    if (!teamName) return;
    const dir = path6.join(config.paths.teams, teamName, "inboxes");
    let names;
    try {
      names = await fs4.readdir(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const entries = await readJsonSafe(path6.join(dir, name));
      if (!Array.isArray(entries)) continue;
      const to = name.replace(/\.json$/, "");
      store.append("mail", { source: "inbox", to, entries }, to);
    }
  };
  const handleTeamsJson = async (file) => {
    const base = path6.basename(file);
    const dirName = path6.basename(path6.dirname(file));
    if (base === "config.json") {
      if (config.sessionOnly) return;
      if (teamName && dirName !== teamName) return;
      const cfg = await readJsonSafe(file);
      if (!cfg) return;
      lastConfig = cfg;
      const learned = teamName !== cfg.name || leadSessionId !== cfg.leadSessionId;
      teamName = cfg.name;
      leadSessionId = cfg.leadSessionId;
      if (learned) config.onTeam?.({ teamName: cfg.name, leadSessionId: cfg.leadSessionId });
      if (learned) {
        disowned.clear();
        chain.clear();
        if (leadSessionId) chain.add(leadSessionId);
        leadProjectDir = null;
        forkParent.clear();
        forkChecked.clear();
        for (const f of [...pending.keys()]) {
          if (claimOfTranscript(f, chain, leadName)?.scoped !== true) forget(f);
        }
        for (const f of [...usageLedger.keys()]) {
          if (claimOfTranscript(f, chain, leadName)?.scoped !== true) forget(f);
        }
      }
      for (const [f, meta] of unresolvedSidecars) {
        if (meta.taskKind === "in_process_teammate") acceptSidecar(f, meta);
        else adoptSubagent(transcriptOfSidecar(f), meta);
      }
      unresolvedSidecars.clear();
      for (const f of [...unresolvedWorkflows]) await handleWorkflowFile(f);
      if (learned) workflowUsage.flush();
      if (learned) await readOwnInboxes();
      appendRoster();
      return;
    }
    if (dirName !== "inboxes") return;
    if (!teamName || path6.basename(path6.dirname(path6.dirname(file))) !== teamName) return;
    const to = base.replace(/\.json$/, "");
    const entries = await readJsonSafe(file);
    if (!Array.isArray(entries)) return;
    store.append("mail", { source: "inbox", to, entries }, to);
  };
  const isRosterMember = (name) => (lastConfig?.members ?? []).some((m) => m.name === name);
  const adoptLeadSessionOf = (transcriptPath) => {
    const sessionDir = path6.basename(path6.dirname(path6.dirname(transcriptPath)));
    if (sessionDir === "" || chain.has(sessionDir)) return;
    chain.add(sessionDir);
    config.onLeadSession?.(sessionDir);
  };
  const acceptSidecar = (file, meta) => {
    const transcriptPath = transcriptOfSidecar(file);
    if (meta.teamName === teamName && isRosterMember(meta.name)) adoptLeadSessionOf(transcriptPath);
    const claim = claimOfTranscript(transcriptPath, chain, leadName);
    if (meta.teamName !== teamName || claim?.scoped !== true) {
      forget(transcriptPath);
      return false;
    }
    sidecars.set(transcriptPath, meta);
    disowned.delete(transcriptPath);
    own(meta.name, transcriptPath);
    flushPending(meta.name, transcriptPath);
    return true;
  };
  const handleProjectsJson = async (file) => {
    if (!file.endsWith(".meta.json")) return;
    const meta = await readJsonSafe(file);
    if (!meta) return;
    if (meta.taskKind !== "in_process_teammate") {
      const transcript = transcriptOfSidecar(file);
      if (!chainKnown(chain)) unresolvedSidecars.set(file, meta);
      else adoptSubagent(transcript, meta);
      forget(transcript);
      return;
    }
    if (!teamName || !leadSessionId) {
      if (teamName && meta.teamName !== teamName) {
        forget(transcriptOfSidecar(file));
        return;
      }
      unresolvedSidecars.set(file, meta);
      return;
    }
    unresolvedSidecars.delete(file);
    if (acceptSidecar(file, meta)) appendRoster();
  };
  const handleTaskJson = async (file) => {
    if (teamName && path6.basename(path6.dirname(file)) !== teamName) return;
    const task = await readJsonSafe(file);
    if (!task || typeof task.id !== "string") return;
    store.append("task", task, task.owner);
  };
  const handleSessionJson = async (file) => {
    const doc = await readJsonSafe(file);
    const sid = typeof doc?.sessionId === "string" ? doc.sessionId : path6.basename(file, ".json");
    if (chain.size > 0 && !chain.has(sid)) return;
    const ours = chain.has(sid);
    const branch = doc?.gitBranch ?? doc?.branch;
    const sessionName = typeof doc?.name === "string" && doc.name ? doc.name : void 0;
    if (!branch && !(ours && sessionName)) return;
    store.append("statusline", { branch, sessionName: ours ? sessionName : void 0 }, leadName);
  };
  const handleWorkflowFile = async (file) => {
    if (!chainKnown(chain)) {
      unresolvedWorkflows.add(file);
      return;
    }
    const claim = workflowClaimOf(file, chain);
    if (!claim) return;
    unresolvedWorkflows.delete(file);
    if (claim.kind === "snapshot") {
      const run2 = parseWorkflowRun(await readJsonSafe(file));
      if (run2) store.append("workflow", leanRun(run2));
      return;
    }
    let text;
    try {
      text = await fs4.readFile(file, "utf8");
    } catch {
      return;
    }
    store.append("workflow", parseWorkflowJournal(claim.runId, text.split("\n")));
  };
  const dispatchJson = async (file, root) => {
    if (root === paths.teams) await handleTeamsJson(file);
    else if (root === paths.projects) {
      if (isWorkflowPath(file)) await handleWorkflowFile(file);
      else await handleProjectsJson(file);
    } else if (root === paths.tasks) await handleTaskJson(file);
    else if (root === paths.sessions) await handleSessionJson(file);
  };
  const transcripts = watchAppendOnly(paths.projects, (file, lines, fromStart, mtimeMs) => {
    if (isWorkflowPath(file)) {
      void handleWorkflowFile(file).catch((err) => logError(`ingest ${file}`, err));
      return;
    }
    try {
      if (workflowUsage.handle(file, lines, fromStart)) return;
      handleLines(file, lines, fromStart, mtimeMs);
    } catch (err) {
      logError(`ingest ${file}`, err);
    }
    if (deferred.has(file)) return;
    void fs4.stat(file).then(
      (st) => marks.set(file, st.mtimeMs),
      () => void 0
    );
  });
  const sweepTranscript = async (file) => {
    if (isWorkflowPath(file)) {
      await handleWorkflowFile(file);
      return;
    }
    if (subagentOf.has(file) || workflowAgentClaimOf(file)) {
      await transcripts.pump(file);
      return;
    }
    const claim = claimOfTranscript(file, chain, leadName);
    if (!claim || disowned.has(file)) return;
    notePath(sidecars.get(file)?.name ?? claim.agent, file);
    if (deferred.delete(file)) await transcripts.forget(file);
    await transcripts.pump(file);
  };
  const drainAgent = async (agent) => {
    for (const file of transcriptPaths.get(agent) ?? []) await transcripts.pump(file);
  };
  const pollTails = async () => {
    const files = /* @__PURE__ */ new Set();
    for (const set of transcriptPaths.values()) for (const file of set) files.add(file);
    await Promise.all([...files].map((file) => transcripts.pump(file)));
  };
  const growForkChain = async (files) => {
    if (!leadSessionId) return;
    if (!leadProjectDir) {
      const own2 = files.find((f) => path6.basename(f) === `${leadSessionId}.jsonl`);
      if (own2) leadProjectDir = path6.dirname(own2);
    }
    if (!leadProjectDir) return;
    for (const file of files) {
      if (!file.endsWith(".jsonl") || path6.dirname(file) !== leadProjectDir) continue;
      const stem = path6.basename(file, ".jsonl");
      if (forkChecked.has(stem) || SUBAGENT_FILE.test(path6.basename(file))) continue;
      let firstLine;
      try {
        firstLine = await readFirstLine(file);
      } catch {
        continue;
      }
      if (firstLine === null) continue;
      let parsed;
      try {
        parsed = JSON.parse(firstLine);
      } catch {
        continue;
      }
      forkChecked.add(stem);
      const parent = parsed.forkedFrom?.sessionId;
      if (parent) forkParent.set(stem, parent);
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const [id, parent] of forkParent) {
        if (chain.has(parent) && !chain.has(id)) {
          chain.add(id);
          changed = true;
        }
      }
    }
  };
  const sweep = async () => {
    for (const root of [paths.teams, paths.projects, paths.tasks, paths.sessions]) {
      const files = await walk(root);
      if (root === paths.projects) await growForkChain(files);
      const drains = [];
      for (const file of files) {
        if (closed) return;
        let st;
        try {
          st = await fs4.stat(file);
        } catch {
          continue;
        }
        if ((marks.get(file) ?? -1) >= st.mtimeMs) continue;
        marks.set(file, st.mtimeMs);
        if (file.endsWith(".jsonl")) drains.push({ file, mtimeMs: st.mtimeMs });
        else if (file.endsWith(".json")) await dispatchJson(file, root);
      }
      drains.sort((a, b) => a.mtimeMs - b.mtimeMs);
      for (const drain2 of drains) {
        if (closed) return;
        await sweepTranscript(drain2.file);
      }
    }
  };
  const watchers = [
    transcripts,
    watchJsonTree(paths.projects, (file) => {
      void settle(file)(isWorkflowPath(file) ? handleWorkflowFile(file) : handleProjectsJson(file));
    }),
    watchJsonTree(paths.teams, (file) => {
      void settle(file)(handleTeamsJson(file));
    }),
    watchJsonTree(paths.tasks, (file) => {
      void settle(file)(handleTaskJson(file));
    }),
    watchJsonTree(paths.sessions, (file) => {
      void settle(file)(handleSessionJson(file));
    })
  ];
  const interval = config.sweepIntervalMs ?? DEFAULT_SWEEP_MS;
  let sweeping = null;
  const timer = interval > 0 ? setInterval(() => {
    if (sweeping) return;
    sweeping = sweep().catch((err) => logError("reconciliation sweep", err)).finally(() => {
      sweeping = null;
    });
  }, interval) : null;
  timer?.unref?.();
  const pollMs = config.tailPollMs ?? TAIL_POLL_MS;
  const poll = pollMs > 0 ? setInterval(() => {
    void pollTails().catch((err) => logError("tail poll", err));
  }, pollMs) : null;
  poll?.unref?.();
  return {
    sweep,
    drainAgent,
    close() {
      closed = true;
      if (timer) clearInterval(timer);
      if (poll) clearInterval(poll);
      for (const w of watchers) w.close();
    }
  };
}

// src/server/control/permits.ts
import { randomUUID as randomUUID2 } from "node:crypto";
var AUTO_DENY_FACTOR = 0.9;
function holdMsFor(timeoutMs) {
  return Math.floor(timeoutMs * AUTO_DENY_FACTOR);
}
function autoDenyReason(timeoutMs) {
  return `auto-denied after ${holdMsFor(timeoutMs)}ms with no operator response`;
}
function createPermits() {
  const held = /* @__PURE__ */ new Map();
  return {
    hold(agent, toolName, input, timeoutMs) {
      const id = randomUUID2();
      const holdMs = holdMsFor(timeoutMs);
      let settle;
      const promise = new Promise((res) => {
        settle = res;
      });
      const timer = setTimeout(() => {
        held.delete(id);
        settle({ decision: "deny", reason: autoDenyReason(timeoutMs) });
      }, holdMs);
      timer.unref?.();
      held.set(id, {
        permit: { id, agent, toolName, input, expiresAt: Date.now() + holdMs },
        timer,
        settle: (decision, reason) => settle({ decision, reason })
      });
      return { id, promise };
    },
    resolve(id, decision, reason) {
      const entry = held.get(id);
      if (!entry) return false;
      clearTimeout(entry.timer);
      held.delete(id);
      entry.settle(decision, reason);
      return true;
    },
    list() {
      return [...held.values()].map((e) => e.permit);
    }
  };
}

// src/server/ingest/hooks.ts
var DEFAULT_PERMISSION_TIMEOUT_MS = 6e5;
var SUBAGENT_ID = /^a(.+)-[0-9a-f]{16}$/;
var bagOf2 = (v) => v !== null && typeof v === "object" ? v : {};
var str3 = (v) => typeof v === "string" ? v : void 0;
var num2 = (v) => typeof v === "number" && Number.isFinite(v) ? v : void 0;
function agentNameFrom(raw, leadName = "team-lead") {
  const id = str3(raw);
  if (!id) return leadName;
  const at = id.indexOf("@");
  if (at > 0) return id.slice(0, at);
  const m = SUBAGENT_ID.exec(id);
  return m ? m[1] : id;
}
function pctOf(raw) {
  const n = num2(raw);
  if (n !== void 0) return n;
  const b = bagOf2(raw);
  return num2(b.used_pct) ?? num2(b.utilization) ?? num2(b.percent);
}
function resetOf(raw) {
  const b = bagOf2(raw);
  return str3(b.resets_at) ?? str3(b.reset_at) ?? str3(b.resetsAt);
}
function createHookHandlers(deps) {
  const { store, permits } = deps;
  const leadName = deps.leadName ?? "team-lead";
  const touched = (agent) => {
    try {
      deps.onAgentActivity?.(agent);
    } catch (err) {
      logError("drain on hook", err);
    }
  };
  const shutdown = deps.onShutdown ?? (() => {
    logInfo("lead session ended \u2014 exiting");
    process.exit(0);
  });
  return {
    async hook(body) {
      try {
        const b = bagOf2(body);
        const event = str3(b.hook_event_name) ?? "";
        const agent = agentNameFrom(b.agent_id, leadName);
        const toolName = str3(b.tool_name);
        const text = str3(b.message) ?? str3(b.prompt);
        store.append("hook", { event, agent, toolName, text }, agent);
        touched(agent);
        if (event === "SessionEnd") {
          const ending = str3(b.session_id);
          const lead = deps.leadSessionId?.();
          if (lead && ending === lead) {
            setTimeout(shutdown, 250);
          } else {
            debug("hook", `SessionEnd for ${ending ?? "an unknown session"} is not the lead's`);
          }
        }
        if (event !== "PermissionRequest") return { status: 200, body: {} };
        if (deps.readOnly) return { status: 200, body: {} };
        const timeoutMs = num2(b.timeout) ?? deps.permissionTimeoutMs ?? DEFAULT_PERMISSION_TIMEOUT_MS;
        const held = permits.hold(agent, toolName ?? "unknown", b.tool_input, timeoutMs);
        store.append(
          "needsyou",
          {
            id: held.id,
            kind: "permission",
            agent,
            reason: "permission",
            detail: `${toolName ?? "unknown"} \u2014 awaiting your decision`,
            expiresAt: Date.now() + holdMsFor(timeoutMs)
          },
          agent
        );
        const decided = await held.promise;
        store.append("needsyou-resolved", { id: held.id }, agent);
        return {
          status: 200,
          body: {
            hookSpecificOutput: {
              hookEventName: "PermissionRequest",
              permissionDecision: decided.decision,
              permissionDecisionReason: decided.reason ?? ""
            }
          }
        };
      } catch (err) {
        logError("hook", err);
        return { status: 200, body: {} };
      }
    },
    async statusline(body) {
      try {
        const b = bagOf2(body);
        const cost = bagOf2(b.cost);
        const window = bagOf2(b.context_window);
        const limits = bagOf2(b.rate_limits);
        const agent = agentNameFrom(b.agent_id, leadName);
        store.append(
          "statusline",
          {
            totalCostUsd: num2(cost.total_cost_usd),
            contextTokens: num2(window.used_tokens) ?? num2(window.input_tokens),
            contextWindow: num2(window.max_tokens) ?? num2(window.context_window_size),
            branch: str3(b.gitBranch) ?? str3(b.branch),
            fiveHourPct: pctOf(limits.five_hour),
            sevenDayPct: pctOf(limits.seven_day),
            resetsAt: resetOf(limits.five_hour)
          },
          agent
        );
        touched(agent);
      } catch (err) {
        logError("statusline hook", err);
      }
      return { status: 200, body: {} };
    },
    async substatus(body) {
      try {
        const b = bagOf2(body);
        const tasks = Array.isArray(b.tasks) ? b.tasks : [];
        for (const raw of tasks) {
          const t = bagOf2(raw);
          if (str3(t.type) !== "in_process_teammate") continue;
          const agent = agentNameFrom(t.agentId ?? t.agent_id ?? t.name, leadName);
          store.append(
            "substatus",
            {
              agent,
              tokenCount: num2(t.tokenCount),
              contextWindowSize: num2(t.contextWindowSize),
              status: str3(t.status),
              model: str3(t.model)
            },
            agent
          );
          touched(agent);
        }
      } catch (err) {
        logError("substatus hook", err);
      }
      return { status: 200, body: {} };
    }
  };
}

// src/server/control/mailbox.ts
var import_proper_lockfile = __toESM(require_proper_lockfile(), 1);
import { promises as fs5 } from "node:fs";
import { randomUUID as randomUUID3 } from "node:crypto";
import os from "node:os";
import path7 from "node:path";
var teamsRoot = path7.join(os.homedir(), ".claude", "teams");
function setTeamsRoot(root) {
  teamsRoot = root;
}
async function atomicWrite(filePath, data) {
  const tmp = `${filePath}.${process.pid}.${randomUUID3()}.tmp`;
  await fs5.writeFile(tmp, data, "utf8");
  await fs5.rename(tmp, filePath);
}
async function colorOf(teamName, agent) {
  const config = await readJsonSafe(path7.join(teamsRoot, teamName, "config.json"));
  return config?.members.find((m) => m.name === agent)?.color;
}
var SAFE_NAME = /^[A-Za-z0-9_-]+$/;
async function sendToInbox(teamName, toAgent, body) {
  if (!SAFE_NAME.test(teamName) || !SAFE_NAME.test(toAgent)) {
    throw new Error(`refusing to write an inbox for ${JSON.stringify(`${teamName}/${toAgent}`)}`);
  }
  const from = body.from ?? "team-lead";
  const dir = path7.join(teamsRoot, teamName, "inboxes");
  const file = path7.join(dir, `${toAgent}.json`);
  if (!path7.resolve(file).startsWith(path7.resolve(dir) + path7.sep)) {
    throw new Error(`refusing to write ${file} outside ${dir}`);
  }
  await fs5.mkdir(dir, { recursive: true });
  const color = await colorOf(teamName, from);
  const msgId = randomUUID3();
  const release = await import_proper_lockfile.default.lock(file, {
    lockfilePath: `${file}.lock`,
    realpath: false,
    retries: { retries: 20, minTimeout: 10, maxTimeout: 200 }
  });
  try {
    const existing = await readJsonSafe(file) ?? [];
    const entry = {
      from,
      text: body.text,
      summary: body.summary,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      color,
      msgV: 1,
      msg_id: msgId,
      type: "message",
      read: false
    };
    await atomicWrite(file, JSON.stringify([...Array.isArray(existing) ? existing : [], entry], null, 2));
  } finally {
    await release();
  }
  return { msgId };
}

// src/server/stream.ts
var COALESCE_MS = 250;
var HEARTBEAT_MS = 15e3;
function frame(event, state) {
  return `event: ${event}
data: ${JSON.stringify(state)}

`;
}
function createStream(snapshot, coalesceMs = COALESCE_MS) {
  const clients = /* @__PURE__ */ new Set();
  let timer = null;
  let lastFlush = 0;
  let closed = false;
  const flush = () => {
    if (clients.size === 0) return;
    try {
      const payload = frame("state", snapshot());
      for (const res of clients) res.write(payload);
    } catch (err) {
      logError("stream flush", err);
    }
  };
  const heartbeat = setInterval(() => {
    for (const res of clients) res.write(": keepalive\n\n");
  }, HEARTBEAT_MS);
  heartbeat.unref?.();
  return {
    subscribe(res) {
      if (closed) {
        res.end();
        return;
      }
      const first = frame("snapshot", snapshot());
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no"
      });
      res.write(first);
      clients.add(res);
      res.on("close", () => clients.delete(res));
    },
    publish() {
      if (closed || timer) return;
      const wait = Math.max(0, coalesceMs - (Date.now() - lastFlush));
      timer = setTimeout(() => {
        timer = null;
        lastFlush = Date.now();
        flush();
      }, wait);
      timer.unref?.();
    },
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      clearInterval(heartbeat);
      for (const res of clients) res.end();
      clients.clear();
    },
    get clients() {
      return clients.size;
    }
  };
}

// src/server/http.ts
import http from "node:http";
import { promises as fs6 } from "node:fs";
import path8 from "node:path";
var READ_ONLY_BODY = {
  error: "read-only",
  message: "the console was started with --read-only; control routes are disabled"
};
var NO_BUNDLE_BODY = {
  error: "no build",
  message: "dist/web is missing \u2014 run `npm run build` first"
};
var FORBIDDEN_BODY = {
  error: "forbidden",
  message: "the console only answers same-origin requests from this machine"
};
var UNSUPPORTED_MEDIA_BODY = {
  error: "unsupported media type",
  message: "content-type: application/json is required"
};
var BAD_SEGMENT_BODY = {
  error: "bad request",
  message: "name must match /^[A-Za-z0-9_-]+$/"
};
var DEFAULT_WEB_DIST = path8.join(PLUGIN_DIR, "dist", "web");
var MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};
function contentTypeFor(file) {
  return MIME_TYPES[path8.extname(file).toLowerCase()] ?? "application/octet-stream";
}
async function serveWebBundle(res, webDist, route) {
  const isAsset = route.startsWith("/assets/");
  const target = path8.join(webDist, isAsset ? route : "index.html");
  if (!target.startsWith(path8.join(webDist, path8.sep))) {
    json(res, 404, { error: "not found", message: `no route for GET ${route}` });
    return;
  }
  try {
    const data = await fs6.readFile(target);
    res.writeHead(200, {
      "content-type": contentTypeFor(target),
      "content-length": data.length
    });
    res.end(data);
  } catch {
    if (isAsset) {
      json(res, 404, { error: "not found", message: `no route for GET ${route}` });
    } else {
      json(res, 503, NO_BUNDLE_BODY);
    }
  }
}
var AGENT_ROUTE = /^\/api\/agents\/([^/]+)\/(message|interrupt|stop|respawn)$/;
var PLAN_ROUTE = /^\/api\/plans\/([^/]+)\/(approve|reject)$/;
var PERMIT_ROUTE = /^\/api\/permits\/([^/]+)\/(allow|deny)$/;
var TEAM_SELECT_ROUTE = /^\/api\/teams\/([^/]+)\/select$/;
var SESSION_SELECT_ROUTE = /^\/api\/select-session\/([^/]+)$/;
var SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/;
function decodeSegment(raw) {
  let decoded;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return SAFE_SEGMENT.test(decoded) ? decoded : null;
}
var LOCAL_HOSTS = /* @__PURE__ */ new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
function isLocalHost(host) {
  if (!host) return false;
  try {
    return LOCAL_HOSTS.has(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}
function isLocalOrigin(origin) {
  if (origin === void 0) return true;
  try {
    return LOCAL_HOSTS.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}
function isJsonBody(contentType) {
  return (contentType ?? "").split(";")[0].trim().toLowerCase() === "application/json";
}
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.length === 0) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
}
var str4 = (v) => typeof v === "string" ? v : void 0;
function createHttpServer(deps) {
  const leadName = deps.leadName ?? "team-lead";
  const webDist = deps.webDist ?? DEFAULT_WEB_DIST;
  const team = () => deps.state().teamName;
  return http.createServer((req, res) => {
    void (async () => {
      try {
        const method = req.method ?? "GET";
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        const route = url.pathname;
        if (!isLocalHost(req.headers.host)) {
          json(res, 403, FORBIDDEN_BODY);
          return;
        }
        if (method === "POST") {
          if (!isLocalOrigin(req.headers.origin)) {
            json(res, 403, FORBIDDEN_BODY);
            return;
          }
          if (!isJsonBody(req.headers["content-type"])) {
            json(res, 415, UNSUPPORTED_MEDIA_BODY);
            return;
          }
        }
        if (method === "GET" && route === "/stream") {
          deps.stream.subscribe(res);
          return;
        }
        if (method === "GET" && route === "/health") {
          const s = deps.state();
          json(res, 200, { ok: true, team: s.teamName, agents: s.agents.length });
          return;
        }
        if (method === "GET" && route === "/api/teams" && deps.listTeams) {
          json(res, 200, await deps.listTeams());
          return;
        }
        if (method === "GET" && route === "/api/history" && deps.history) {
          const agent = url.searchParams.get("agent") ?? "";
          if (!agent) {
            json(res, 400, { error: "bad request", message: "agent is required" });
            return;
          }
          json(res, 200, { agent, lines: deps.history(agent) });
          return;
        }
        if (method === "GET" && route === "/api/line" && deps.lineText) {
          const agent = url.searchParams.get("agent") ?? "";
          const id = url.searchParams.get("id") ?? "";
          if (!agent || !id) {
            json(res, 400, { error: "bad request", message: "agent and id are required" });
            return;
          }
          const text = deps.lineText(agent, id);
          if (text === void 0) {
            json(res, 404, { error: "not found", message: "no stored record for that line" });
            return;
          }
          json(res, 200, { id, text });
          return;
        }
        if (method === "POST" && (route === "/hook" || route === "/statusline" || route === "/substatus")) {
          const body2 = await readBody(req);
          const out = route === "/hook" ? await deps.hooks.hook(body2) : route === "/statusline" ? await deps.hooks.statusline(body2) : await deps.hooks.substatus(body2);
          deps.stream.publish();
          json(res, out.status, out.body);
          return;
        }
        if (method === "GET" && !route.startsWith("/api/")) {
          await serveWebBundle(res, webDist, route);
          return;
        }
        if (method !== "POST" || !route.startsWith("/api/")) {
          json(res, 404, { error: "not found", message: `no route for ${method} ${route}` });
          return;
        }
        const selectMatch = TEAM_SELECT_ROUTE.exec(route);
        const sessionMatch = SESSION_SELECT_ROUTE.exec(route);
        const select = selectMatch && deps.selectTeam ? { raw: selectMatch[1], key: "team", run: deps.selectTeam } : sessionMatch && deps.selectSession ? { raw: sessionMatch[1], key: "session", run: deps.selectSession } : null;
        if (select) {
          const name = decodeSegment(select.raw);
          if (name === null) {
            json(res, 400, BAD_SEGMENT_BODY);
            return;
          }
          const out = await select.run(name);
          if (out.ok) {
            json(res, 200, { ok: true, [select.key]: name, changed: out.changed });
          } else if (out.reason === "busy") {
            json(res, 409, { error: "switch in progress", message: out.message });
          } else {
            json(res, 404, { error: "not found", message: out.message });
          }
          return;
        }
        if (deps.readOnly) {
          json(res, 409, READ_ONLY_BODY);
          return;
        }
        if (route === "/api/shutdown") {
          json(res, 200, {});
          setTimeout(() => deps.onShutdown?.(), 50).unref?.();
          return;
        }
        const body = await readBody(req);
        const timestamp = (/* @__PURE__ */ new Date()).toISOString();
        const agentMatch = AGENT_ROUTE.exec(route);
        if (agentMatch) {
          const name = decodeSegment(agentMatch[1]);
          if (name === null) {
            json(res, 400, BAD_SEGMENT_BODY);
            return;
          }
          const action = agentMatch[2];
          if (action === "message") {
            const text = str4(body.text);
            if (!text) {
              json(res, 400, { error: "bad request", message: "text is required" });
              return;
            }
            const out2 = await sendToInbox(team(), name, {
              text,
              summary: str4(body.summary),
              from: name === leadName ? CONSOLE_SENDER : leadName
            });
            deps.stream.publish();
            json(res, 200, out2);
            return;
          }
          if (action === "respawn") {
            const out2 = await sendToInbox(team(), leadName, {
              text: `Teammate ${name} needs respawning. Re-spawn it with the same role and prompt.`,
              summary: `respawn ${name}`,
              from: leadName
            });
            deps.stream.publish();
            json(res, 200, out2);
            return;
          }
          const out = await sendToInbox(team(), name, {
            text: JSON.stringify({ type: "shutdown_request", reason: action, from: leadName, timestamp }),
            summary: `${action} ${name}`,
            from: leadName
          });
          deps.stream.publish();
          json(res, 200, out);
          return;
        }
        const planMatch = PLAN_ROUTE.exec(route);
        if (planMatch) {
          const requestId = decodeSegment(planMatch[1]);
          if (requestId === null) {
            json(res, 400, BAD_SEGMENT_BODY);
            return;
          }
          const approved = planMatch[2] === "approve";
          const card = deps.state().needsYou.find((n) => n.id === requestId);
          if (!card) {
            json(res, 404, { error: "not found", message: `no pending plan ${requestId}` });
            return;
          }
          if (card.kind !== "plan") {
            json(res, 404, {
              error: "not found",
              message: `${requestId} is a ${card.kind} card, not a plan`
            });
            return;
          }
          if (!SAFE_SEGMENT.test(card.agent)) {
            json(res, 400, BAD_SEGMENT_BODY);
            return;
          }
          const out = await sendToInbox(team(), card.agent, {
            text: JSON.stringify({
              type: "plan_approval_response",
              requestId,
              approved,
              feedback: str4(body.feedback),
              timestamp
            }),
            summary: `plan ${approved ? "approved" : "rejected"}`,
            from: leadName
          });
          deps.stream.publish();
          json(res, 200, out);
          return;
        }
        const permitMatch = PERMIT_ROUTE.exec(route);
        if (permitMatch) {
          const id = decodeSegment(permitMatch[1]);
          if (id === null) {
            json(res, 400, BAD_SEGMENT_BODY);
            return;
          }
          const decision = permitMatch[2] === "allow" ? "allow" : "deny";
          const ok = deps.permits.resolve(id, decision, str4(body.reason));
          if (!ok) {
            json(res, 404, { error: "not found", message: `no held permit ${id}` });
            return;
          }
          deps.stream.publish();
          json(res, 200, {});
          return;
        }
        json(res, 404, { error: "not found", message: `no route for ${method} ${route}` });
      } catch (err) {
        json(res, 500, { error: "server error", message: err.message });
      }
    })();
  });
}
function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server.address().port));
  });
}

// src/server/setup.ts
import { promises as fs7 } from "node:fs";
import path9 from "node:path";
import { execFile as execFile2 } from "node:child_process";
import { promisify as promisify2 } from "node:util";
var run = promisify2(execFile2);
var PINNED_CLAUDE_VERSION = "2.1.231";
var HOOK_TIMEOUT_SECONDS = 5;
var PERMISSION_HOOK_TIMEOUT_SECONDS = DEFAULT_PERMISSION_TIMEOUT_MS / 1e3;
var LAUNCH_HOOK_TIMEOUT_SECONDS = 5;
var BACKUP_FILE = "agent-teams-console.backup.json";
var AGENT_ENV_VARS = [
  "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS",
  "CLAUDE_CODE_ENABLE_TODO_TOOLS"
];
var HOOK_EVENTS = [
  "PreToolUse",
  "PostToolUse",
  "PermissionRequest",
  "UserPromptSubmit",
  "Notification",
  "Stop",
  "SubagentStop",
  "SessionStart",
  "SessionEnd",
  "PreCompact"
];
var MATCHER_EVENTS = /* @__PURE__ */ new Set(["PreToolUse", "PostToolUse", "PermissionRequest"]);
var CONSOLE_HOOK_URL = /^http:\/\/127\.0\.0\.1:\d+\/hook$/;
var CONSOLE_HOOK_COMMAND_URL = /http:\/\/127\.0\.0\.1:\d+\/hook\b/;
function post(port, route) {
  return `curl -sS -m 2 -X POST -H 'content-type: application/json' --data-binary @- http://127.0.0.1:${port}/${route} >/dev/null 2>&1; printf ''`;
}
function observe(port, timeoutSeconds) {
  return `curl -sS -m ${timeoutSeconds} -X POST -H 'content-type: application/json' --data-binary @- http://127.0.0.1:${port}/hook 2>/dev/null || OCTO_PORT=${port} '${RESTART_SCRIPT}'; exit 0`;
}
function hookBlock(port) {
  const hooks = {};
  for (const event of HOOK_EVENTS) {
    const timeout = event === "PermissionRequest" ? PERMISSION_HOOK_TIMEOUT_SECONDS : HOOK_TIMEOUT_SECONDS;
    const entry = {
      hooks: [{ type: "command", command: observe(port, timeout), timeout }]
    };
    if (MATCHER_EVENTS.has(event)) entry.matcher = "*";
    hooks[event] = [entry];
  }
  const launcher = {
    matcher: "Agent",
    hooks: [
      {
        type: "command",
        // The launcher defaults OCTO_PORT to 4823, so `setup --port 5000`
        // used to write hooks pointing at 5000 while the launcher started
        // the server on 4823. Carry the port across the language boundary.
        command: `OCTO_PORT=${port} '${LAUNCH_SCRIPT}'`,
        timeout: LAUNCH_HOOK_TIMEOUT_SECONDS
      }
    ]
  };
  const workflowLauncher = { ...launcher, matcher: "Workflow" };
  hooks.PreToolUse = [...hooks.PreToolUse ?? [], launcher, workflowLauncher];
  hooks.PostToolUse = [...hooks.PostToolUse ?? [], { ...launcher }, { ...workflowLauncher }];
  return {
    hooks,
    statusLine: { type: "command", command: post(port, "statusline"), refreshInterval: 5 },
    subagentStatusLine: { type: "command", command: post(port, "substatus") },
    env: Object.fromEntries(AGENT_ENV_VARS.map((name) => [name, "1"]))
  };
}
function isConsoleEntry(entry) {
  const hooks = entry?.hooks;
  if (!Array.isArray(hooks)) return false;
  return hooks.some(
    (h) => h?.type === "http" && typeof h.url === "string" && CONSOLE_HOOK_URL.test(h.url) || h?.type === "command" && typeof h.command === "string" && (h.command.includes("console-launch.sh") || CONSOLE_HOOK_COMMAND_URL.test(h.command))
  );
}
function isConsoleStatusLine(value, route) {
  const command = value?.command;
  return typeof command === "string" && command.includes(`127.0.0.1:`) && command.includes(`/${route}`);
}
function mergeHookBlock(settings, port) {
  const block = hookBlock(port);
  const existing = settings.hooks ?? {};
  const hooks = {};
  for (const [event, entries] of Object.entries(existing)) {
    hooks[event] = (Array.isArray(entries) ? entries : []).filter((e) => !isConsoleEntry(e));
  }
  for (const event of HOOK_EVENTS) {
    hooks[event] = [...hooks[event] ?? [], ...block.hooks[event]];
  }
  return {
    ...settings,
    hooks,
    statusLine: keptStatusLine(settings.statusLine, block.statusLine, "statusline"),
    subagentStatusLine: keptStatusLine(settings.subagentStatusLine, block.subagentStatusLine, "substatus"),
    env: { ...settings.env ?? {}, ...block.env }
  };
}
function keptStatusLine(existing, ours, route) {
  if (existing === void 0 || isConsoleStatusLine(existing, route)) return ours;
  return existing;
}
function removeHookBlock(settings) {
  const out = { ...settings };
  const existing = settings.hooks;
  if (existing) {
    const hooks = {};
    for (const [event, entries] of Object.entries(existing)) {
      const kept = (Array.isArray(entries) ? entries : []).filter((e) => !isConsoleEntry(e));
      if (kept.length > 0) hooks[event] = kept;
    }
    if (Object.keys(hooks).length > 0) out.hooks = hooks;
    else delete out.hooks;
  }
  if (isConsoleStatusLine(out.statusLine, "statusline")) delete out.statusLine;
  if (isConsoleStatusLine(out.subagentStatusLine, "substatus")) delete out.subagentStatusLine;
  const env = settings.env;
  if (env) {
    const kept = Object.fromEntries(
      Object.entries(env).filter(([key, value]) => !(AGENT_ENV_VARS.includes(key) && value === "1"))
    );
    if (Object.keys(kept).length > 0) out.env = kept;
    else delete out.env;
  }
  return out;
}
function checkClaudeVersion(raw) {
  const version = raw ? /(\d+\.\d+\.\d+)/.exec(raw)?.[1] : void 0;
  if (!version) {
    return {
      ok: false,
      message: `could not read \`claude --version\`; the console is pinned to ${PINNED_CLAUDE_VERSION} internals`
    };
  }
  if (version === PINNED_CLAUDE_VERSION) {
    return { ok: true, message: `claude ${version} matches the pinned contract` };
  }
  return {
    ok: false,
    message: `claude ${version} does not match the pinned ${PINNED_CLAUDE_VERSION}; the control plane writes internal protocols and may be wrong`
  };
}
async function readClaudeVersion() {
  try {
    const { stdout } = await run("claude", ["--version"], { timeout: 5e3 });
    return stdout.trim();
  } catch {
    return null;
  }
}
function envBackup(settings) {
  const env = settings.env ?? {};
  return Object.fromEntries(
    AGENT_ENV_VARS.map((name) => [name, typeof env[name] === "string" ? env[name] : null])
  );
}
function backupPathFor(settingsPath) {
  return path9.join(path9.dirname(settingsPath), BACKUP_FILE);
}
async function runSetup(opts) {
  const block = hookBlock(opts.port);
  const lines = [];
  if (!opts.uninstall) {
    lines.push(`This block goes into ${opts.settingsPath}:`, "", JSON.stringify(block, null, 2), "");
  } else {
    lines.push(
      `This removes the console's hooks and its own status lines from ${opts.settingsPath},`,
      `and puts ${AGENT_ENV_VARS.join(" and ")} back the way you had them.`,
      ""
    );
  }
  if (!opts.confirm) {
    lines.push("nothing was written \u2014 re-run with --yes to apply.");
    return lines.join("\n");
  }
  let current = {};
  try {
    current = JSON.parse(await fs7.readFile(opts.settingsPath, "utf8"));
  } catch {
    current = {};
  }
  const next = opts.uninstall ? removeHookBlock(current) : mergeHookBlock(current, opts.port);
  await fs7.mkdir(path9.dirname(opts.settingsPath), { recursive: true });
  const backupPath = backupPathFor(opts.settingsPath);
  const saved = await readJsonSafe(backupPath);
  if (opts.uninstall) {
    if (saved?.env) {
      const env = { ...next.env ?? {} };
      for (const [name, value] of Object.entries(saved.env)) {
        if (typeof value === "string") env[name] = value;
      }
      if (Object.keys(env).length > 0) next.env = env;
      else delete next.env;
      lines.push(`put ${AGENT_ENV_VARS.join(" and ")} back the way you had them.`);
    }
    await fs7.rm(backupPath, { force: true });
  } else {
    if (saved === null) {
      await atomicWrite(backupPath, `${JSON.stringify({ env: envBackup(current) }, null, 2)}
`);
    }
    if (current.statusLine && !isConsoleStatusLine(current.statusLine, "statusline")) {
      lines.push("left your own status line alone \u2014 no rate-limit gauge or lead cost readout.");
    }
    lines.push(`${AGENT_ENV_VARS.join(" and ")} are on \u2014 restart Claude Code for the task tools to load.`);
  }
  await atomicWrite(opts.settingsPath, `${JSON.stringify(next, null, 2)}
`);
  lines.push(opts.uninstall ? "removed." : "written.");
  return lines.join("\n");
}

// src/server/index.ts
var execFileAsync2 = promisify3(execFile3);
var DEFAULT_PORT = 4823;
var IDLE_GRACE_MS = 10 * 60 * 1e3;
var FOLLOW_INTERVAL_MS = 3e3;
function parseArgs(argv) {
  let command = "run";
  let port = DEFAULT_PORT;
  let readOnly = false;
  let confirm = false;
  let claudeHome = process.env.CLAUDE_CONFIG_DIR || path10.join(os2.homedir(), ".claude");
  let team;
  let session;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "setup" || arg === "uninstall") command = arg;
    else if (arg === "--read-only") readOnly = true;
    else if (arg === "--yes") confirm = true;
    else if (arg === "--port") port = Number(argv[++i]);
    else if (arg.startsWith("--port=")) port = Number(arg.slice("--port=".length));
    else if (arg === "--claude-home") claudeHome = argv[++i];
    else if (arg.startsWith("--claude-home=")) claudeHome = arg.slice("--claude-home=".length);
    else if (arg === "--team") team = argv[++i];
    else if (arg.startsWith("--team=")) team = arg.slice("--team=".length);
    else if (arg === "--session") session = argv[++i];
    else if (arg.startsWith("--session=")) session = arg.slice("--session=".length);
  }
  return {
    command,
    port,
    readOnly,
    confirm,
    claudeHome,
    settingsPath: path10.join(claudeHome, "settings.json"),
    dbPath: path10.join(claudeHome, "agent-teams-console", "events.db"),
    team,
    session
  };
}
function toDiscovered(config) {
  const leadCwd = config.members.find((m) => m.agentId === config.leadAgentId)?.cwd ?? "";
  return {
    teamName: config.name,
    leadSessionId: config.leadSessionId,
    projectSlug: leadCwd.replace(/[^a-zA-Z0-9]/g, "-")
  };
}
async function isSessionLive(sessionsRoot, sessionId) {
  if (!sessionId) return false;
  const session = await readJsonSafe(
    path10.join(sessionsRoot, `${sessionId}.json`)
  );
  return typeof session?.pid === "number" && isPidAlive(session.pid);
}
async function discoverTeam(teamsRoot2, sessionsRoot, explicitTeam) {
  if (explicitTeam) {
    const config = await readJsonSafe(path10.join(teamsRoot2, explicitTeam, "config.json"));
    return config ? toDiscovered(config) : null;
  }
  let entries;
  try {
    entries = await fs8.readdir(teamsRoot2);
  } catch {
    return null;
  }
  const dirs = [];
  for (const name of entries) {
    try {
      if ((await fs8.stat(path10.join(teamsRoot2, name))).isDirectory()) dirs.push(name);
    } catch {
    }
  }
  const configs = [];
  for (const name of dirs) {
    const config = await readJsonSafe(path10.join(teamsRoot2, name, "config.json"));
    if (config) configs.push(config);
  }
  if (configs.length === 0) return null;
  const realTeams = configs.filter((c) => c.members.length >= 2);
  const candidates = realTeams.length > 0 ? realTeams : configs;
  let best = null;
  let bestLive = false;
  for (const config of candidates) {
    const live = realTeams.length > 0 && await isSessionLive(sessionsRoot, config.leadSessionId);
    const better = !best || live && !bestLive || live === bestLive && config.createdAt > best.createdAt;
    if (better) {
      best = config;
      bestLive = live;
    }
  }
  return best ? toDiscovered(best) : null;
}
async function readSessions(sessionsRoot) {
  const facts = { live: /* @__PURE__ */ new Set(), names: /* @__PURE__ */ new Map(), cwds: /* @__PURE__ */ new Map() };
  let entries;
  try {
    entries = await fs8.readdir(sessionsRoot);
  } catch {
    return facts;
  }
  const docs = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const doc = await readJsonSafe(path10.join(sessionsRoot, entry));
    if (typeof doc?.sessionId !== "string") continue;
    docs.push({ sessionId: doc.sessionId, pid: doc.pid, name: doc.name, cwd: doc.cwd });
  }
  const spares = await recycledSpares(
    docs.map((d) => d.pid).filter((p) => typeof p === "number")
  );
  for (const doc of docs) {
    if (typeof doc.pid === "number" && isPidAlive(doc.pid) && !spares.has(doc.pid)) {
      facts.live.add(doc.sessionId);
    }
    if (typeof doc.name === "string" && doc.name !== "") facts.names.set(doc.sessionId, doc.name);
    if (typeof doc.cwd === "string" && doc.cwd !== "") facts.cwds.set(doc.sessionId, doc.cwd);
  }
  return facts;
}
async function branchOf(cwd) {
  if (!cwd) return void 0;
  try {
    const head = await fs8.readFile(path10.join(cwd, ".git", "HEAD"), "utf8");
    const ref = /^ref:\s+refs\/heads\/(.+)$/m.exec(head.trim());
    return ref ? ref[1] : void 0;
  } catch {
    return void 0;
  }
}
var GIT_TIMEOUT_MS = 2e3;
async function diffstatOf(cwd) {
  if (!cwd) return void 0;
  try {
    const { stdout } = await execFileAsync2("git", ["diff", "--shortstat", "HEAD"], {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 64 * 1024
    });
    return parseShortstat(stdout);
  } catch {
    return void 0;
  }
}
function parseShortstat(out) {
  const added = Number(/(\d+) insertions?\(\+\)/.exec(out)?.[1] ?? 0);
  const removed = Number(/(\d+) deletions?\(-\)/.exec(out)?.[1] ?? 0);
  return added === 0 && removed === 0 ? void 0 : { added, removed };
}
async function lastActivityOf(teamDir, configMtimeMs) {
  let latest = configMtimeMs;
  let entries;
  try {
    entries = await fs8.readdir(path10.join(teamDir, "inboxes"));
  } catch {
    return latest;
  }
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    try {
      const st = await fs8.stat(path10.join(teamDir, "inboxes", entry));
      if (st.mtimeMs > latest) latest = st.mtimeMs;
    } catch {
    }
  }
  return latest;
}
async function subagentCountOf(projectsRoot, cwd, sessionId) {
  if (!cwd || !sessionId) return 0;
  const dir = path10.join(
    projectsRoot,
    cwd.replace(/[^a-zA-Z0-9]/g, "-"),
    sessionId,
    "subagents"
  );
  try {
    const entries = await fs8.readdir(dir);
    return entries.filter((e) => /^agent-.*\.jsonl$/.test(e)).length;
  } catch {
    return 0;
  }
}
async function workflowOf(projectsRoot, cwd, sessionId, now) {
  if (!cwd || !sessionId) return void 0;
  const sessionDir = path10.join(projectsRoot, cwd.replace(/[^a-zA-Z0-9]/g, "-"), sessionId);
  const runsDir = path10.join(sessionDir, "subagents", "workflows");
  let entries;
  try {
    entries = await fs8.readdir(runsDir);
  } catch {
    return void 0;
  }
  let runId = "";
  let journalMtimeMs = 0;
  for (const entry of entries) {
    try {
      const st = await fs8.stat(path10.join(runsDir, entry, "journal.jsonl"));
      if (st.mtimeMs > journalMtimeMs) {
        journalMtimeMs = st.mtimeMs;
        runId = entry;
      }
    } catch {
    }
  }
  if (!runId) return void 0;
  const snapshot = path10.join(sessionDir, "workflows", `${runId}.json`);
  let ended = false;
  try {
    ended = (await fs8.stat(snapshot)).isFile();
  } catch {
  }
  const name = ended ? await workflowNameOf(snapshot) : void 0;
  return {
    runId,
    ...name ? { name } : {},
    live: !ended && now - journalMtimeMs < IDLE_GRACE_MS
  };
}
async function workflowNameOf(snapshot) {
  try {
    const raw = JSON.parse(await fs8.readFile(snapshot, "utf8"));
    return typeof raw.workflowName === "string" && raw.workflowName ? raw.workflowName : void 0;
  } catch {
    return void 0;
  }
}
async function teamsOfLiveSessions(projectsRoot, sessions) {
  const teams = /* @__PURE__ */ new Map();
  for (const sessionId of sessions.live) {
    const cwd = sessions.cwds.get(sessionId);
    if (!cwd) continue;
    const dir = path10.join(projectsRoot, cwd.replace(/[^a-zA-Z0-9]/g, "-"), sessionId, "subagents");
    let entries;
    try {
      entries = await fs8.readdir(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".meta.json")) continue;
      const meta = await readJsonSafe(
        path10.join(dir, entry)
      );
      if (meta?.taskKind !== "in_process_teammate") continue;
      if (typeof meta.teamName === "string" && meta.teamName !== "") {
        teams.set(meta.teamName, sessionId);
      }
    }
  }
  return teams;
}
async function sessionProjectDir(projectsRoot, sessionId, cwd) {
  const isDir = async (dir) => {
    try {
      return (await fs8.stat(dir)).isDirectory();
    } catch {
      return false;
    }
  };
  if (cwd) {
    const dir = path10.join(projectsRoot, cwd.replace(/[^a-zA-Z0-9]/g, "-"), sessionId);
    if (await isDir(dir)) return dir;
  }
  let slugs;
  try {
    slugs = await fs8.readdir(projectsRoot);
  } catch {
    return null;
  }
  for (const slug of slugs) {
    const dir = path10.join(projectsRoot, slug, sessionId);
    if (await isDir(dir)) return dir;
  }
  return null;
}
async function soloSessionRows(projectsRoot, sessions, covered, diffstats, now) {
  const rows = [];
  for (const sessionId of sessions.live) {
    if (covered.has(sessionId)) continue;
    const cwd = sessions.cwds.get(sessionId);
    if (!cwd) continue;
    const subagents = await subagentCountOf(projectsRoot, cwd, sessionId);
    if (subagents === 0) continue;
    const dir = path10.join(projectsRoot, cwd.replace(/[^a-zA-Z0-9]/g, "-"), sessionId);
    let lastActivityAt = now;
    try {
      lastActivityAt = (await fs8.stat(path10.join(dir, "subagents"))).mtimeMs;
    } catch {
    }
    if (!diffstats.has(cwd)) diffstats.set(cwd, await diffstatOf(cwd));
    rows.push({
      // The SESSION id, not a team directory: `sessionOnly` below is what tells
      // the client to send it to /api/select-session rather than /select.
      name: sessionId,
      sessionOnly: true,
      members: 1,
      createdAt: 0,
      leadSessionId: sessionId,
      leadAlive: true,
      lastActivityAt,
      live: true,
      current: false,
      branch: await branchOf(cwd),
      goal: sessions.names.get(sessionId),
      state: "live",
      subagents,
      ...diffstats.get(cwd) ? { diffstat: diffstats.get(cwd) } : {}
    });
  }
  return rows;
}
async function listTeamSummaries(teamsRoot2, sessionsRoot, current, projectsRoot) {
  let entries = [];
  try {
    entries = await fs8.readdir(teamsRoot2);
  } catch {
  }
  const sessions = await readSessions(sessionsRoot);
  const liveTeams = projectsRoot ? await teamsOfLiveSessions(projectsRoot, sessions) : /* @__PURE__ */ new Map();
  const now = Date.now();
  const teams = [];
  const leadCwds = /* @__PURE__ */ new Map();
  const diffstats = /* @__PURE__ */ new Map();
  for (const name of entries) {
    const teamDir = path10.join(teamsRoot2, name);
    let configMtimeMs;
    try {
      const st = await fs8.stat(path10.join(teamDir, "config.json"));
      if (!st.isFile()) continue;
      configMtimeMs = st.mtimeMs;
    } catch {
      continue;
    }
    const config = await readJsonSafe(path10.join(teamDir, "config.json"));
    if (!config || typeof config.name !== "string" || !Array.isArray(config.members)) continue;
    const leadSessionId = typeof config.leadSessionId === "string" ? config.leadSessionId : "";
    const leadSession = liveTeams.get(name) ?? leadSessionId;
    const leadAlive = liveTeams.has(name) || leadSessionId !== "" && sessions.live.has(leadSessionId);
    const lastActivityAt = await lastActivityOf(teamDir, configMtimeMs);
    const recent = now - lastActivityAt < IDLE_GRACE_MS;
    const lead = config.members.find((m) => m.agentId === config.leadAgentId) ?? config.members[0];
    leadCwds.set(name, lead?.cwd ?? "");
    const workflow = projectsRoot ? await workflowOf(projectsRoot, sessions.cwds.get(leadSession) ?? lead?.cwd ?? "", leadSession, now) : void 0;
    const subagents = projectsRoot ? await subagentCountOf(projectsRoot, sessions.cwds.get(leadSession) ?? lead?.cwd ?? "", leadSession) : 0;
    const leadCwd = lead?.cwd ?? "";
    if (!diffstats.has(leadCwd)) diffstats.set(leadCwd, await diffstatOf(leadCwd));
    teams.push({
      // The DIRECTORY name, not config.name: the ingest gates its own team's
      // config.json on the directory, so a mismatch would make the team
      // unselectable in practice.
      name,
      members: config.members.length,
      createdAt: typeof config.createdAt === "number" ? config.createdAt : 0,
      leadSessionId,
      leadAlive,
      lastActivityAt,
      live: leadAlive || recent,
      current: name === current,
      branch: await branchOf(lead?.cwd),
      // Named after the session actually driving the team. Keyed on
      // config.leadSessionId this was blank for every re-keyed team — the live
      // one showed no name while a four-hour-dead one showed its own.
      goal: sessions.names.get(leadSession),
      // `idle` is a team whose lead process is gone but whose files moved
      // recently — it can still be paged back into; `done` is finished.
      state: leadAlive ? "live" : recent ? "idle" : "done",
      ...workflow ? { workflow } : {},
      ...subagents > 0 ? { subagents } : {},
      ...diffstats.get(leadCwd) ? { diffstat: diffstats.get(leadCwd) } : {}
    });
  }
  const adopted = adoptByCwd(teams, leadCwds, sessions, now);
  if (projectsRoot) {
    const covered = /* @__PURE__ */ new Set([
      ...teams.map((t) => t.leadSessionId),
      ...liveTeams.values(),
      ...adopted
    ]);
    teams.push(...await soloSessionRows(projectsRoot, sessions, covered, diffstats, now));
  }
  teams.sort(
    (a, b) => Number(b.current) - Number(a.current) || Number(b.live) - Number(a.live) || b.lastActivityAt - a.lastActivityAt || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  );
  return { current, teams };
}
function adoptByCwd(teams, leadCwds, sessions, now) {
  const adopted = /* @__PURE__ */ new Set();
  const byCwd = /* @__PURE__ */ new Map();
  const ambiguous = /* @__PURE__ */ new Set();
  for (const sessionId of sessions.live) {
    const cwd = sessions.cwds.get(sessionId);
    if (!cwd) continue;
    if (byCwd.has(cwd)) ambiguous.add(cwd);
    else byCwd.set(cwd, sessionId);
  }
  for (const cwd of ambiguous) byCwd.delete(cwd);
  if (byCwd.size === 0) return adopted;
  const claimed = new Set(teams.filter((t) => t.leadAlive).map((t) => t.name));
  for (const [cwd, sessionId] of byCwd) {
    const best = teams.filter(
      (t) => !claimed.has(t.name) && leadCwds.get(t.name) === cwd && // Bounded, and this bound is the whole point. Sharing a working
      // directory is weak evidence — two sessions open on the same repo is
      // ordinary — so without it a live session with no team of its own
      // adopts the most recent LEFTOVER team in that directory and reports
      // it as live. Observed: a session adopting a team last touched 26
      // hours earlier, which then showed as `1 agent live` in the picker.
      // A session genuinely driving a re-keyed team is writing to it, so
      // requiring recent movement keeps the `/branch` case and drops the
      // corpses.
      now - t.lastActivityAt < IDLE_GRACE_MS
    ).sort((a, b) => b.lastActivityAt - a.lastActivityAt)[0];
    if (!best) continue;
    claimed.add(best.name);
    adopted.add(sessionId);
    best.leadAlive = true;
    best.live = true;
    best.state = "live";
    best.goal ??= sessions.names.get(sessionId);
  }
  return adopted;
}
function fencedSink(live, generation, current) {
  const mine = () => generation === current();
  return {
    // No caller reads this event back; the return only satisfies the contract.
    append: (kind, payload, agent) => mine() ? live.append(kind, payload, agent) : { seq: 0, ts: Date.now(), kind, agent, payload },
    replay: () => live.replay(),
    setTeam: (name) => {
      if (mine()) live.setTeam(name);
    },
    close: () => {
    }
  };
}
async function main(argv) {
  const cli = parseArgs(argv);
  if (cli.command === "setup" || cli.command === "uninstall") {
    const guard2 = checkClaudeVersion(await readClaudeVersion());
    if (!guard2.ok) console.warn(`warning: ${guard2.message}`);
    console.log(
      await runSetup({
        settingsPath: cli.settingsPath,
        port: cli.port,
        confirm: cli.confirm,
        uninstall: cli.command === "uninstall"
      })
    );
    return 0;
  }
  process.on("unhandledRejection", (err) => logError("unhandled rejection", err));
  process.on("uncaughtException", (err) => logError("uncaught exception", err));
  const guard = checkClaudeVersion(await readClaudeVersion());
  console.log(guard.ok ? guard.message : `warning: ${guard.message}`);
  const teamsRoot2 = path10.join(cli.claudeHome, "teams");
  const sessionsRoot = path10.join(cli.claudeHome, "sessions");
  const projectsRoot = path10.join(cli.claudeHome, "projects");
  setTeamsRoot(teamsRoot2);
  const discovered = await discoverTeam(teamsRoot2, sessionsRoot, cli.team);
  const teamName = discovered?.teamName ?? cli.team;
  let leadSessionId = discovered?.leadSessionId ?? cli.session;
  const store = openStore(cli.dbPath, teamName ?? "");
  const permits = createPermits();
  const publish = () => {
    const events = store.replay();
    const team = project(events, cli.readOnly);
    const workflows = foldWorkflows(events);
    return {
      ...team,
      // Hook-supplied values win; the disk-derived ones are the floor, so the
      // header is right whether or not the status line is installed.
      sessionName: team.sessionName ?? leadFacts.sessionName,
      branch: team.branch ?? leadFacts.branch,
      mode: modeOf(team.agents.length, workflows),
      workflows
    };
  };
  const hub = createStream(publish);
  const live = {
    append(kind, payload, agent) {
      const ev = store.append(kind, payload, agent);
      hub.publish();
      return ev;
    },
    replay: () => store.replay(),
    setTeam: (name) => store.setTeam(name),
    close: () => store.close()
  };
  let generation = 0;
  let currentTeam = teamName ?? "";
  let currentSession = teamName ? "" : leadSessionId ?? "";
  const startIngest = (gen, team, lead) => startFileIngest(fencedSink(live, gen, () => generation), {
    paths: {
      projects: path10.join(cli.claudeHome, "projects"),
      teams: teamsRoot2,
      tasks: path10.join(cli.claudeHome, "tasks"),
      sessions: path10.join(cli.claudeHome, "sessions")
    },
    teamName: team,
    leadSessionId: lead,
    sessionOnly: team === void 0 && lead !== void 0,
    onTeam: (info) => {
      if (gen !== generation) return;
      store.setTeam(info.teamName);
      currentTeam = info.teamName;
      leadSessionId = info.leadSessionId;
    },
    onLeadSession: (id) => {
      if (gen === generation) leadSessionId = id;
    }
  });
  let ingest = startIngest(generation, teamName, leadSessionId);
  await ingest.sweep();
  let switching = false;
  let pinned = false;
  let leadFacts = {};
  const retarget = async (team, lead) => {
    const gen = ++generation;
    ingest.close();
    store.setTeam(team);
    leadSessionId = lead;
    currentTeam = team;
    currentSession = "";
    leadFacts = {};
    ingest = startIngest(gen, team, lead);
    await ingest.sweep();
    hub.publish();
  };
  const selectTeam = async (team) => {
    if (team === currentTeam) {
      pinned = true;
      return { ok: true, changed: false };
    }
    if (switching) {
      return { ok: false, reason: "busy", message: `a team switch is already running \u2014 retry ${team}` };
    }
    switching = true;
    try {
      let exists = false;
      try {
        exists = (await fs8.stat(path10.join(teamsRoot2, team))).isDirectory();
      } catch {
      }
      if (!exists) return { ok: false, reason: "missing", message: `no team ${team}` };
      const config = await readJsonSafe(path10.join(teamsRoot2, team, "config.json"));
      if (!config || typeof config.name !== "string" || !Array.isArray(config.members)) {
        logError(`select ${team}`, new Error("config.json is missing or unreadable"));
        return {
          ok: false,
          reason: "missing",
          message: `teams/${team}/config.json is missing or unreadable`
        };
      }
      await retarget(team, typeof config.leadSessionId === "string" ? config.leadSessionId : "");
      pinned = true;
      return { ok: true, changed: true };
    } finally {
      switching = false;
    }
  };
  const retargetSession = async (sessionId) => {
    const gen = ++generation;
    ingest.close();
    store.setTeam(sessionId);
    leadSessionId = sessionId;
    currentTeam = "";
    currentSession = sessionId;
    leadFacts = {};
    ingest = startIngest(gen, void 0, sessionId);
    await ingest.sweep();
    hub.publish();
  };
  const selectSession = async (sessionId) => {
    if (sessionId === currentSession) {
      pinned = true;
      return { ok: true, changed: false };
    }
    if (switching) {
      return {
        ok: false,
        reason: "busy",
        message: `a team switch is already running \u2014 retry ${sessionId}`
      };
    }
    switching = true;
    try {
      const sessions = await readSessions(sessionsRoot);
      const dir = await sessionProjectDir(projectsRoot, sessionId, sessions.cwds.get(sessionId));
      if (!dir) return { ok: false, reason: "missing", message: `no session ${sessionId}` };
      await retargetSession(sessionId);
      pinned = true;
      return { ok: true, changed: true };
    } finally {
      switching = false;
    }
  };
  let reaper = null;
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    reaper?.stop();
    clearInterval(follower);
    ingest.close();
    hub.close();
    server.close();
    store.close();
    process.exit(0);
  };
  const server = createHttpServer({
    permits,
    hooks: createHookHandlers({
      store: live,
      permits,
      readOnly: cli.readOnly,
      leadSessionId: () => leadSessionId,
      onAgentActivity: (agent) => void ingest.drainAgent(agent),
      onShutdown: stop
    }),
    stream: hub,
    state: publish,
    readOnly: cli.readOnly,
    listTeams: () => listTeamSummaries(teamsRoot2, sessionsRoot, currentTeam, projectsRoot),
    history: (agent) => transcriptHistory(store.replay(), agent),
    lineText: (agent, id) => transcriptLineText(store.replay(), agent, id),
    selectTeam,
    selectSession,
    onShutdown: stop
  });
  const port = await listen(server, cli.port);
  console.log(`agent teams console on http://127.0.0.1:${port}${cli.readOnly ? " (read-only)" : ""}`);
  const followRealTeam = async () => {
    if (switching) return;
    const { teams } = await listTeamSummaries(teamsRoot2, sessionsRoot, currentTeam, projectsRoot);
    const mine = teams.find((t) => t.name === currentTeam);
    leadFacts = { sessionName: mine?.goal, branch: mine?.branch };
    if (pinned) return;
    if (teams.some((t) => t.name === currentTeam && t.members >= 2)) return;
    const target = teams.find((t) => t.members >= 2 && t.live);
    if (!target || target.name === currentTeam) return;
    switching = true;
    try {
      logInfo(`following ${target.name} (${target.members} members)`);
      await retarget(target.name, target.leadSessionId);
    } catch (err) {
      logError("follow", err);
    } finally {
      switching = false;
    }
  };
  const follower = setInterval(() => void followRealTeam(), FOLLOW_INTERVAL_MS);
  follower.unref();
  void followRealTeam();
  reaper = startIdleReaper({
    watchedTeam: () => currentTeam,
    teamsRoot: teamsRoot2,
    graceMs: IDLE_GRACE_MS,
    onIdle: () => {
      logInfo("nothing live to show \u2014 exiting");
      process.exit(0);
    }
  });
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  return 0;
}
if (process.argv[1] && import.meta.url.endsWith(path10.basename(process.argv[1]))) {
  void main(process.argv.slice(2));
}
export {
  DEFAULT_PORT,
  FOLLOW_INTERVAL_MS,
  IDLE_GRACE_MS,
  discoverTeam,
  fencedSink,
  listTeamSummaries,
  main,
  parseArgs,
  parseShortstat,
  sessionProjectDir
};
