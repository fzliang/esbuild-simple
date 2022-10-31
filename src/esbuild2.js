const fs = require('fs');
const tty = require('tty');
const child_process = require("child_process");


const {
  createChannel
} = require("./common");

const ourselves = require('./esbuild2');

const isTTY = () => tty.isatty(2);

const version = "0.15.12";

const defaultWD = process.cwd();

const binPath = defaultWD + '/bin/esbuild';

var esbuildCommandAndArgs = () => [binPath, []]

var fsSync = {
  readFile(tempFile, callback) {
    try {
      let contents = fs.readFileSync(tempFile, "utf8");
      try {
        fs.unlinkSync(tempFile);
      } catch {
      }
      callback(null, contents);
    } catch (err) {
      callback(err, null);
    }
  },
  writeFile(contents, callback) {
    try {
      let tempFile = randomFileName();
      fs.writeFileSync(tempFile, contents);
      callback(tempFile);
    } catch {
      callback(null);
    }
  }
};

var fsAsync = {
  readFile(tempFile, callback) {
    try {
      fs.readFile(tempFile, "utf8", (err, contents) => {
        try {
          fs.unlink(tempFile, () => callback(err, contents));
        } catch {
          callback(err, contents);
        }
      });
    } catch (err) {
      callback(err, null);
    }
  },
  writeFile(contents, callback) {
    try {
      let tempFile = randomFileName();
      fs.writeFile(tempFile, contents, (err) => err !== null ? callback(null) : callback(tempFile));
    } catch {
      callback(null);
    }
  }
};


var longLivedService;
var ensureServiceIsRunning = () => {
  if (longLivedService)
    return longLivedService;

  const [command, args] = esbuildCommandAndArgs();

  const child = child_process.spawn(command, args.concat(`--service=${version}`, "--ping"), {
    windowsHide: true,
    stdio: ["pipe", "pipe", "inherit"],
    cwd: defaultWD
  })

  let { readFromStdout, afterClose, service } = createChannel({
    writeToStdin(bytes) {
      child.stdin.write(bytes, (err) => {
        if (err)
          afterClose(err);
      });
    },
    readFileSync: fs.readFileSync,
    isSync: false,
    isWriteUnavailable: false,
    esbuild: ourselves
  });

  child.on('error', afterClose);

  const stdin = child.stdin;
  const stdout = child.stdout;

  stdin.on('error', afterClose);

  stdout.on('data', readFromStdout);

  stdout.on('end', afterClose);

  let refCount = 0;
  child.unref();
  if (stdin.unref) {
    stdin.unref();
  }
  if (stdout.unref) {
    stdout.unref();
  }
  const refs = {
    ref() {
      if (++refCount === 1)
        child.ref();
    },
    unref() {
      if (--refCount === 0)
        child.unref();
    }
  };

  longLivedService = {
    build: (options) => {
      return new Promise((resolve, reject) => {
        service.buildOrServe({
          callName: "build",
          refs,
          serveOptions: null,
          options,
          isTTY: isTTY(),
          defaultWD,
          callback: (err, res) => err ? reject(err) : resolve(res)
        });
      });
    },
    transform: (input, options) => {
      return new Promise((resolve, reject) => service.transform({
        callName: "transform",
        refs,
        input,
        options: options || {},
        isTTY: isTTY(),
        fs: fsAsync,
        callback: (err, res) => err ? reject(err) : resolve(res)
      }));
    }
  };
  return longLivedService;
}
var build = (options) => ensureServiceIsRunning().build(options);
var transform = (input, options) => ensureServiceIsRunning().transform(input, options);

var runServiceSync = (callback) => {
  let [command, args] = esbuildCommandAndArgs();
  let stdin = new Uint8Array();
  let { readFromStdout, afterClose, service } = createChannel({
    writeToStdin(bytes) {
      if (stdin.length !== 0)
        throw new Error("Must run at most one command");
      stdin = bytes;
    },
    isSync: true,
    isWriteUnavailable: false,
    esbuild: ourselves
  });
  callback(service);
  let stdout = child_process.execFileSync(command, args.concat(`--service=${version}`), {
    cwd: defaultWD,
    windowsHide: true,
    input: stdin,
    maxBuffer: +process.env.ESBUILD_MAX_BUFFER || 16 * 1024 * 1024
  });
  readFromStdout(stdout);
  afterClose(null);
};

var transformSync = (input, options) => {
  let result;
  runServiceSync((service) => service.transform({
    callName: "transformSync",
    refs: null,
    input,
    options: options || {},
    isTTY: isTTY(),
    fs: fsSync,
    callback: (err, res) => {
      if (err)
        throw err;
      result = res;
    }
  }));
  return result;
};

module.exports = {
  transform,
  transformSync,
  build
}