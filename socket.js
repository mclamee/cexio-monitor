var _username;
var _api_key;
var _api_secret;
 
 function create(secrets) //Set variable
 {
  _username = secrets.userName;
  _api_key = secrets.apiKey;
  _api_secret = secrets.apiSecret;
 }

var crypto = require('crypto');

function createAuthRequest(apiKey, apiSecret){
	function createSignature(timestamp, apiKey, apiSecret){
		var hmac = crypto.createHmac('sha256', apiSecret );
		hmac.update( timestamp + apiKey );
		return hmac.digest('hex');
	}
	
    var timestamp = Math.floor(Date.now() / 1000);  // Note: java and javascript timestamp presented in miliseconds
    var args = { e: 'auth', auth: { key: apiKey, 
        signature: createSignature(timestamp, apiKey, apiSecret), timestamp: timestamp } };
    var authMessage = JSON.stringify( args );
    return authMessage;
}

var CEXWebsocketURL = 'wss://ws.cex.io/ws/';

var WebSocketClient = require('websocket').client;
var client = new WebSocketClient();

client.on('connectFailed', function(error) {
  console.log('Connect Error: ' + error.toString());
});


client.on('connect', function(connection) {
  console.log('WebSocket Client Connected');

  // Connection error
  connection.on('error', function(error) {
    console.log("Connection Error: " + error.toString());
  });

  // Connection closed
  connection.on('close', function() {
    console.log('echo-protocol Connection Closed');
  });

  // Connection incoming message
  connection.on('message', function(message) {
    if (message.type === 'utf8') {
      console.log("Received: '" + message.utf8Data + "'");
    }
  });

});

client.connect(CEXWebsocketURL);

exports.client = client
exports.create = create;