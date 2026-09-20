"use strict";

/*
 * This module is loaded with NODE_OPTIONS in every process started by
 * offline-run.mjs. Keep it dependency-free: it is also inherited by Next and
 * Playwright worker processes.
 */

const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const tls = require("node:tls");

const BLOCKED_MESSAGE =
  "Offline verification blocked an outbound network connection";

function isLoopback(hostname) {
  if (hostname === undefined || hostname === null || hostname === "") {
    return true;
  }

  let host = String(hostname).trim().toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) {
    host = host.slice(1, -1);
  }
  if (host.endsWith(".")) {
    host = host.slice(0, -1);
  }

  return (
    host === "localhost" ||
    host === "::1" ||
    host === "0:0:0:0:0:0:0:1" ||
    (net.isIP(host) === 4 && host.split(".")[0] === "127") ||
    (net.isIP(host) === 6 && host.startsWith("::ffff:127."))
  );
}

function blockUnlessLoopback(hostname) {
  if (!isLoopback(hostname)) {
    // Do not include the URL, hostname, headers, or any environment values in
    // this error. They can contain customer data or credentials.
    throw new Error(BLOCKED_MESSAGE);
  }
}

function hostnameFromHttpArgs(input, options) {
  if (typeof input === "string" || input instanceof URL) {
    return new URL(input).hostname;
  }

  const requestOptions =
    input && typeof input === "object" ? input : options || {};
  return requestOptions.hostname ?? requestOptions.host;
}

function guardHttp(module) {
  const originalRequest = module.request;
  const originalGet = module.get;

  module.request = function offlineRequest(input, options, callback) {
    blockUnlessLoopback(hostnameFromHttpArgs(input, options));
    return originalRequest.apply(this, arguments);
  };

  module.get = function offlineGet(input, options, callback) {
    blockUnlessLoopback(hostnameFromHttpArgs(input, options));
    return originalGet.apply(this, arguments);
  };
}

function hostnameFromConnectArgs(args) {
  let connectArgs = args;
  // net.createConnection normalizes its arguments and passes the resulting
  // array as one argument to Socket.prototype.connect.
  while (Array.isArray(connectArgs[0])) {
    connectArgs = connectArgs[0];
  }
  const first = connectArgs[0];
  if (
    typeof first === "string" &&
    (connectArgs.length === 1 || typeof connectArgs[1] === "function")
  ) {
    // A Unix domain socket is local and does not create an outbound network
    // connection.
    return undefined;
  }
  if (first && typeof first === "object") {
    if (first.path) return undefined;
    return first.host ?? first.hostname;
  }
  return connectArgs[1];
}

guardHttp(http);
guardHttp(https);

const originalSocketConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function offlineSocketConnect(...args) {
  blockUnlessLoopback(hostnameFromConnectArgs(args));
  return originalSocketConnect.apply(this, args);
};

const originalTlsConnect = tls.connect;
tls.connect = function offlineTlsConnect(...args) {
  blockUnlessLoopback(hostnameFromConnectArgs(args));
  return originalTlsConnect.apply(this, args);
};

if (typeof globalThis.fetch === "function") {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = function offlineFetch(input, init) {
    const url =
      typeof input === "string" || input instanceof URL ? input : input.url;
    try {
      blockUnlessLoopback(new URL(url).hostname);
    } catch (error) {
      return Promise.reject(error);
    }
    return originalFetch.call(this, input, init);
  };
}
