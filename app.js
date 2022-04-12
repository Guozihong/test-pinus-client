const PomeloClient = require('pomelo-node-client');
const KcpClient = require('./kcpClient');
const UdpClient = require('./udpClient');

let n = 0;
function getRandHost() {
    let hosts = [
        { host: '118.25.97.56', port: 3010 },
        { host: '127.0.0.1', port: 3010 },
    ];
    return hosts[Math.floor(Math.random() * hosts.length)];
}

let kcpClient = new KcpClient();
kcpClient.init({ 
    ...getRandHost(),
    conv: 112233,
    nodelay: 1,
    interval: 20,
    resend: 2,
    nc: 1
}, function () {
    kcpClient.client.on('onAdd', function (msg) {
        console.log('onAdd receive message: %j', msg);
    });

    kcpClient.client.on('onLeave', function (msg) {
        console.log('onLeave receive message: %j', msg);
    });

    kcpClient.client.on('onChat', function (msg) {
        console.log('onChat receive message: %j', msg);
    });

    kcpClient.client.on('heartbeatTimeout', function (msg) {
        console.log('heartbeatTimeout: %j', msg);
    });

    function request() {
        console.log("request...");
        kcpClient.request('connector.entryHandler.entry', { username: 'py', rid: '1', route: 'connector.entryHandler.ready' }, function (data) {
            console.log('receive enter callback data: %j', data);
        });
    }
    setInterval(() => {
        n ++;
        if (n % 5 === 0) {
            kcpClient.changeClientConfig(getRandHost(), () => {
                console.log('连接切换成功！');
                request();
            });
        } else {
            request();
        }
    }, 5000);
});

// let udpClient = new UdpClient();
// udpClient.init('118.25.97.56', 3010, function() {
//     udpClient.request('connector.entryHandler.entry', {username:'py', rid:'1', route:'connector.entryHandler.entry'}, function(data) {
//       console.log('receive enter callback data: %j', data);
//       /**
//       request('chat.chatHandler.send', {content: 'hello world', target: '*', route: 'onChat'}, function(data) {
//         console.log('receive send callback data: %j', data);
//       });
//       */
//     });
  
//     udpClient.client.on('onAdd', function(msg) {
//       console.log('onAdd receive message: %j', msg);
//     });
  
//     udpClient.client.on('onLeave', function(msg) {
//       console.log('onLeave receive message: %j', msg);
//     });
  
//     udpClient.client.on('onChat', function(msg) {
//       console.log('onChat receive message: %j', msg);
//     });
// });

// var pomeloInstance = new PomeloClient();
// pomeloInstance.init({ host: '118.25.97.56', port: 3010 }, () => {
//   console.log('init finished');
// });