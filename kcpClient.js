var dgram = require('dgram');
var protocol = require('pomelo-protocol');
var kcp = require('node-kcp-x');

var Package = protocol.Package;
var Message = protocol.Message;

var handshakeBuffer = {
  'sys': {
    type: 'kcp-client',
    version: '0.0.1',
    rsa: {}
  },
  'user': {
  }
};

var heartbeatData = Package.encode(Package.TYPE_HEARTBEAT);
var handshakeAckData = Package.encode(Package.TYPE_HANDSHAKE_ACK);
var handshakeData = Package.encode(Package.TYPE_HANDSHAKE, protocol.strencode(JSON.stringify(handshakeBuffer)));

class KcpClient {
  reqId = 0;
  nextHeartbeatTimeout = 0;
  gapThreshold = 100;
  heartbeatInterval = 3000;
  heartbeatTimeout = 6000;
  heartbeatTimeoutId = null;
  heartbeatId = null;
  callbacks = {};
  kcpobj = null;
  connectedCb = null;
  startT = -1;
  handlers = {};
  client = null;
  opts = {};

  init (opts, cb) {
    this.handlers[Package.TYPE_HANDSHAKE] = this.handshake.bind(this);
    this.handlers[Package.TYPE_HEARTBEAT] = this.heartbeat.bind(this);
    this.handlers[Package.TYPE_DATA] = this.onData.bind(this);
    this.handlers[Package.TYPE_KICK] = this.onKick.bind(this);

    this.createClient(opts, cb);
    this.check();
  };

  createClient(opts, cb) {
    this.connectedCb = cb;
    this.opts = opts;
    this.host = opts.host;
    this.port = opts.port;
    this.client = dgram.createSocket("udp4");
    this.client.on("message", (msg, rinfo) => {
      this.kcpobj.input(msg);
    });

    var conv = opts.conv || 123;
    this.kcpobj = new kcp.KCP(conv, opts);

    var nodelay = opts.nodelay || 0;
    var interval = opts.interval || 100;
    var resend = opts.resend || 0;
    var nc = opts.nc || 0;
    this.kcpobj.nodelay(nodelay, interval, resend, nc);

    var sndwnd = opts.sndwnd || 32;
    var rcvwnd = opts.rcvwnd || 32;
    this.kcpobj.wndsize(sndwnd, rcvwnd);

    var mtu = opts.mtu || 1400;
    this.kcpobj.setmtu(mtu);

    this.kcpobj.output((data, size, context) => {
      this.client.send(data, 0, size, context.port, context.host, function (err, bytes) {
        if (!!err) {
          console.error('udp client send message with error: %j', err.stack);
        }
      });
    });

    this.sendHandshake();
  }

  changeClientConfig(opts, cb) {
    console.log('设置host,port', opts);
    this.createClient(Object.assign(this.opts, opts), cb);
  }
  
  check () {
    const now = Date.now();
    this.kcpobj.update(now);

    // 消息派发
    var data;
    while ((data = this.kcpobj.recv()) && data) {
      this.processPackage(Package.decode(data));
    }

    setTimeout(() => this.check(), this.kcpobj.check(now));
  };
  
  send (data) {
    this.kcpobj.send(data);
    // this.kcpobj.flush();
  };
  
  sendHandshake (cb) {
    this.send(handshakeData);
  };
  
  decode (data) {
    var msg = Message.decode(data);
    msg.body = JSON.parse(protocol.strdecode(msg.body));
    return msg;
  };
  
  onData (data) {
    var msg = this.decode(data);
    this.processMessage(msg);
  };
  
  processMessage (msg) {
    if (!msg.id) {
      this.client.emit(msg.route, msg.body);
      return;
    }
    var cb = this.callbacks[msg.id];
    delete this.callbacks[msg.id];
    cb && cb(msg.body);
    return;
  };
  
  onKick (data) {
    data = JSON.parse(protocol.strdecode(data));
    console.log('receive kick data: %j', data);
  };
  
  sendMessage (reqId, route, msg) {
    msg = protocol.strencode(JSON.stringify(msg));
    msg = Message.encode(reqId, Message.TYPE_REQUEST, 0, route, msg);
    var packet = Package.encode(Package.TYPE_DATA, msg);
    this.send(packet);
  };
  
  handshake (data) {
    data = JSON.parse(protocol.strdecode(data));
    console.log('receive handshake data: %j', data);
    if (data.sys && data.sys.heartbeat) {
      this.heartbeatInterval = data.sys.heartbeat * 1000;
      this.heartbeatTimeout = this.heartbeatInterval * 2;
    }
    this.send(handshakeAckData);

    // 连接成功
    if (this.connectedCb) {
      this.connectedCb();
      this.connectedCb = null;
    }
  };
  
  request (route, message, cb) {
    this.reqId++;
    this.callbacks[this.reqId] = cb;
    this.sendMessage(this.reqId, route, message);
  };
  
  heartbeat (data) {
    console.log('receive heartbeat');
    if (this.startT !== -1) {
      console.log((Date.now() - this.startT) / 2);
    }
    if (!this.heartbeatInterval) {
      return;
    }
    if (this.heartbeatTimeoutId) {
      clearTimeout(this.heartbeatTimeoutId);
      this.heartbeatTimeoutId = null;
    }
    if (this.heartbeatId) {
      return;
    }
    this.heartbeatId = setTimeout(() => {
      this.heartbeatId = null;
      console.log('send heartbeat message');
      this.startT = Date.now();
      this.send(heartbeatData);
      this.nextHeartbeatTimeout = Date.now() + this.heartbeatTimeout;
      this.heartbeatTimeoutId = setTimeout(this.heartbeatTimeoutCb.bind(this), this.heartbeatTimeout);
    }, this.heartbeatInterval);
  };
  
  heartbeatTimeoutCb () {
    // var gap = this.nextHeartbeatTimeout - Date.now();
    // if (gap > this.gapThreshold) {
    //   this.heartbeatTimeoutId = setTimeout(this.heartbeatTimeoutCb, gap);
    // } else {
    //   console.error('server heartbeat timeout');
    // }
    console.error('server heartbeat timeout');
    this.client.emit('heartbeatTimeout');
  };
  
  disconnect() {
    try {
      this.client.disconnect();
    } catch (error) {
    }
    try {
      this.kcpobj.release();
    } catch (error) {
    }
  }

  processPackage (msgs) {
    if (Array.isArray(msgs)) {
      for (var i = 0; i < msgs.length; i++) {
        var msg = msgs[i];
        this.handlers[msg.type](msg.body);
      }
    } else {
      this.handlers[msgs.type](msgs.body);
    }
  };
}

module.exports = KcpClient;