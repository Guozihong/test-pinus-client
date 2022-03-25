var dgram = require('dgram');
var protocol = require('pomelo-protocol');
var Package = protocol.Package;
var Message = protocol.Message;

var handshakeBuffer = {
  'sys': {
     type: 'udp-client',
     version: '0.0.1',
     rsa: {}
   },
 'user': {
   }
 };
 
 var heartbeatData = Package.encode(Package.TYPE_HEARTBEAT);
 var handshakeAckData = Package.encode(Package.TYPE_HANDSHAKE_ACK);
 var handshakeData = Package.encode(Package.TYPE_HANDSHAKE, protocol.strencode(JSON.stringify(handshakeBuffer)));

class UdpClient {
  client = null;
  reqId = 0;
  nextHeartbeatTimeout = 0;
  gapThreshold = 100;
  heartbeatInterval = 3000;
  heartbeatTimeout = 6000;
  heartbeatTimeoutId = null;
  handshakeCallback = null;
  heartbeatId = null;
  callbacks = {};
  host = 'localhost';
  port = 3010;
  handlers = {};
  startT = -1;
    
  init (ip, pt, cb) {
    this.host = ip;
    this.port = pt;
    this.client = dgram.createSocket("udp4")
    this.client.on("message", (msg, rinfo) => {
      this.processPackage(Package.decode(msg));
    });

    this.handlers[Package.TYPE_HANDSHAKE] = this.handshake.bind(this);
    this.handlers[Package.TYPE_HEARTBEAT] = this.heartbeat.bind(this);
    this.handlers[Package.TYPE_DATA] = this.onData.bind(this);
    this.handlers[Package.TYPE_KICK] = this.onKick.bind(this);

    this.sendHandshake(cb);
  };
  
  send (data, cb) {
    this.client.send(data, 0, data.length, this.port, this.host, function(err, bytes) {
      if(!!err) {
        console.error('udp client send message with error: %j', err.stack);
      }
      if(!!cb) {
        process.nextTick(cb);
      }
    });
  };
  
  sendHandshake (cb) {
    this.send(handshakeData);
    this.handshakeCallback = cb;
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
    if(!msg.id) {
      this.client.emit(msg.route, msg.body);
      return;
    }
    var cb = this.callbacks[msg.id];
    delete this.callbacks[msg.id];
    cb(msg.body);
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
    this.send(handshakeAckData, this.handshakeCallback);
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
    if(!this.heartbeatInterval) {
      return;
    }
    if(this.heartbeatTimeoutId) {
      clearTimeout(this.heartbeatTimeoutId);
      this.heartbeatTimeoutId = null;
    }
    if(this.heartbeatId) {
      return;
    }
    this.heartbeatId = setTimeout(() => {
      this.heartbeatId = null;
      this.startT = Date.now();
      console.log('send heartbeat message');
      this.send(heartbeatData);
      this.nextHeartbeatTimeout = Date.now() + this.heartbeatTimeout;
      this.heartbeatTimeoutId = setTimeout(this.heartbeatTimeoutCb, this.heartbeatTimeout);
    }, this.heartbeatInterval);
  };
  
  heartbeatTimeoutCb () {
    var gap = this.nextHeartbeatTimeout - Date.now();
    if(gap > gapThreshold) {
      this.heartbeatTimeoutId = setTimeout(this.heartbeatTimeoutCb, gap);
    } else {
      console.error('server heartbeat timeout');
    }
  };
  
  processPackage (msgs) {
    if(Array.isArray(msgs)) {
      for(var i=0; i<msgs.length; i++) {
        var msg = msgs[i];
        this.handlers[msg.type](msg.body);
      }
    } else {
      this.handlers[msgs.type](msgs.body);
    }
  };
}
module.exports = UdpClient;