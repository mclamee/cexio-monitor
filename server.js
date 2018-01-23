const app = {name: "app", author: "williamz"}

var http = require('http');
var fs = require('fs');
var url = require('url');
var qs = require('querystring');

// Get Secrets
var secrets = require("./secrets.js")

// JSON API
var cexapi = require("./cexapi.js");
cexapi.create(secrets);

// Web socket client
var socket = require("./socket.js")
socket.create(secrets);
var cli = socket.client
console.log(cli)

//-----------
console.log(app)
console.log("__dirname=" + __dirname);
//-----------
http.createServer(function (req, res) {
	console.log("-----------------------------------------------------------\nRequest URL: " + req.url + "\n-----------------------------------------------------------")
	
	const reqUrl = url.parse(req.url, true);
	//console.log("Request URL: " + JSON.stringify(reqUrl))
	
	// https://regex101.com/r/x7noxI/1
	const resPattern = /\/(favicon\.ico|resources|[-\w]*)((\/([-\.\/\w]+))*(\/([-:,\w]+)\.?(js|html|css|png|jpg|gif|png|avi|mp3|txt)?))?(\/?\?[-,!@`~<>:"'\w=&\d\.%;\?\+\|\^\$\*\(\)\{\}\[\]]*)?(#.*)?/gi
	var urlParams = execRegex(resPattern, reqUrl.path, function(m){
		var moduleName = m[1];
		var folderPath = m[4]
		var fileName = m[6];
		var fileType = m[7];
		
		return {module: moduleName, folder: folderPath, file: fileName, type: fileType}
	})[0];
	console.log("> URL Params: " + JSON.stringify(urlParams))
	
	var query = reqUrl.query;
	query.date = new Date().getTime();
	console.log("> Query Params: " + JSON.stringify(query))
	
	switch (urlParams.module){
		case "favicon.ico":

			respWithFile("favicon.ico", "ico", res)
			
			break;
			
		case "resources":
			const filePath = __dirname + "/node_modules/" + urlParams.folder + "/dist/" + urlParams.file + (urlParams.type? ("."+urlParams.type): "")
			console.log("Get file from : " + filePath)
			respWithFile(filePath, urlParams.type, res)
			
			break;
		case "data":
			var fileName = urlParams.folder;
			var reportName = urlParams.file;
			if(fileName == "save"){
				// save url data as reports
				saveData("data/"+reportName+".txt", "" + JSON.stringify(query) + "\r\n");
				
				res.writeHead(200, {'Content-Type': 'application/json'});
				res.write("{\"m\": \"successfully!\"}");
				res.end();
				
			} else {
				// load reports
				var path = "data/"+fileName+".txt"
				fs.readFile(path, function(err, data){
					console.log("Get Data File from '" + path + "', bytes: " + data.length)
					
					if (reportName.contains("incChart")) {
						// convert file to JSON object
						data = JSON.parse(("[" + ("" + data).replace(/(?:\r\n|\r|\n)/g, ',') + "]").replace(/,\]/g, "]"))
						
						var frequency = getFrequency(reportName);
						console.log("==> Current Report Frequency : " + frequency)
						var fst = data[0]
						var lst = data[data.length - 1]
						var hoursAgo = lst.date - (parseInt(query.lastHours) * 60*60*1000)
						if(hoursAgo > fst.date) fst.date = hoursAgo;
						var startKey = fst.date - (fst.date % frequency);
						
						data = data.reduce(function(map, obj){
							//console.log("map: " + JSON.stringify(map));
							//console.log("obj: " + JSON.stringify(obj));
							
							var currKey = startKey + frequency * (((obj.date - startKey) / frequency).toFixed(0))
							currKey += "";
							
							if(map[currKey] == undefined){
								map[currKey] = {total: 0.0, cnt: 0, avg: 0.0}
							}
							
							// calculation
							var inc = parseFloat(obj.inc);
							if(inc){
								map[currKey].total = inc + map[currKey].total
								map[currKey].cnt ++;
								map[currKey].avg = (map[currKey].total / map[currKey].cnt).toFixed(2);	
							}
							//console.log("map["+currKey+"] with ("+inc+"): " + JSON.stringify(map[currKey]))
							
							return map;
						}, {});

						data = Object.keys(data).map((e) => {return {x: e, y: data[e].avg};})	
						data = data.filter(e => e.x >= startKey && e.x <= lst.date);
					}
					
					res.writeHead(200, {'Content-Type': 'application/json'});
					data = JSON.stringify(data);
					//console.log("Get Report Data as: " + JSON.stringify(data))
					res.write(data);
					res.end();
				});
			}
			break;
		case "":
		case "/":
			res.writeHead(301, {
				Location: '/' + app.name}
			);
			res.end();
			
			break;
		case app.name:
			
			// gen resp
			fs.readFile('index.html', 'utf8', function(err, fileContent) {
				
				cexapi.balance(function(param){
					if(param.error){
						response500("Call cex.io API failed, please check the setup in secrets.js file. <br/> <br/> Error: " + param.error);
						return;
					}
					
					console.log("> Balance Data From Cex.io: " + JSON.stringify(param))
					
					// get balance data from cex.io and add into list for replacement
					const regex = /\{\{([\w\._\d]+)\}\}/g;
					var list = execRegex(regex, fileContent, function (m){
						var key = m[1]
						var value = (key.contains("app.")) ? eval(key) : (param?eval(`param.${key}`):param);
						//console.log("Exec: " + key + "=" + value);
						return {key: key, value: value}
					});
					
					// add extra data: Total Deposit
					var depositHistoryData = fs.readFileSync("app/deposits/data.json", "utf8");
					var his = JSON.parse(depositHistoryData) || [];
					var total = his.reduce((a, x) => a+x.amt+x.fee, 0.0)
					list.push({key: "total-deposit", value: total.toFixed(2)});
					
					// replace params by {{name}} pattern
					console.log("> Replace HTML Content: ");
					list.forEach((v, i) => {
						console.log("--> " + v.key + "|" + v.value)
						fileContent = fileContent.replace("\{\{"+v.key+"\}\}", v.value == undefined ? "": v.value);
					});
					res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
					res.write(fileContent);
					res.end();
				});
			});
			
			break;
			
		case "deposits":
			var action = urlParams.file;
			if(!action){
				action = "list"
			}
			console.log(action)
			
			var dataFile = "app/deposits/data.json";
			
			if(req.method === 'DELETE'){
				var id = parseInt(urlParams.file)
				console.log("Deleting item: " + id)
				
				updateHistory((his) => {
					console.log("before: ", JSON.stringify(his))
					his = his.filter((x) => x.id !== id)
					console.log("after: ", JSON.stringify(his))
					return his;
				})
				
			} else if (req.method === 'GET' || req.method === 'POST'){
				if(req.method === 'GET' && action == "sum"){

					fs.readFile(dataFile, "utf8", (e, data) => {
						if (e) {
							console.log("read file error", err)
							res.writeHead(500);
							res.end();
							return;
						}
						var his = JSON.parse(data) || [];
						var total = his.reduce((a, x) => a+x.amt+x.fee, 0.0)
						res.writeHead(200, {'Content-Type': 'application/json'});
						res.write("{\"total\": "+total.toFixed(2)+"}");
						res.end();
					});
					
				} else if(action == "list"){
					respWithFile(dataFile, "json", res);
				} else if(action == "edit"){
					respWithFile("app/deposits/index.html", "html", res);
				} else if(req.method === 'POST' & action == "save"){

					let body = [];
					req.on('data', (chunk) => {
						body.push(chunk);
					}).on('end', () => {
						body = Buffer.concat(body).toString();
						const parsed = qs.parse(body);
						doDeposit(parsed)
					});
					
					function doDeposit(params){
						
						var amt = parseFloat(params.amount)
						var fee = parseFloat(params.fee)

						var depDate = params.depositDate
						
						updateHistory((his) => {
							var maxId = his.reduce((a, x) => Math.max(a, x.id), 0);

							his.push({id: ++maxId, amt: amt, fee: fee, depDate: depDate})
							
							his.sort((a, b) => {
								var comp1 = Date.parse(a.depDate) - Date.parse(b.depDate);
								if(comp1 == 0){
									var comp2 = a.amt - b.amt + a.fee - b.fee;
									if(comp2 == 0){
										return a.id - b.id;
									}
									return comp2
								}
								return comp1
							})
							return his;
						})
					}
				} else {
					response404();
				}
			}
			
			function updateHistory(fnUpdate){
				fs.readFile(dataFile, "utf8", (e, data) => {
					if (e) {
						console.log("read file error", err)
						res.writeHead(500);
						res.end();
						return;
					}
					
					var his = JSON.parse(data) || [];
					
					his = fnUpdate(his);
					
					fs.writeFile(dataFile, JSON.stringify(his), (err) => {
						if (err) {
							console.log("save file error", err)
							res.writeHead(500);
							res.end();
							return;
						}
						
						console.log('The file has been saved!');
						res.writeHead(200);
						res.write("ok");
						res.end();
					});
				});
			}
			
			break;
		default: 
			response404();
	}
	
	function response404(){
		res.writeHead(404, {'Content-Type': 'text/html'});
		res.write("404 Not Found!");
		res.end();
	}
	
	function response500(msg = "500 Server Error!"){
		res.writeHead(500, {'Content-Type': 'text/html'});
		res.write(msg);
		res.end();
	}	
	function respWithFile(filePath, fileType, response){
		var st = fs.statSync(filePath);

		response.writeHead(200, {
			'Content-Type': determineContentType(fileType),
			'Content-Length': st.size
		});

		var readStream = fs.createReadStream(filePath);
		// We replaced all the event handlers with a simple call to readStream.pipe()
		readStream.pipe(response);
	}

}).listen(8080);

// -- functions

function execRegex(regex, data, fn, debug){
	var list = [];
	var m;
	while ((m = regex.exec(data)) !== null) {
		// This is necessary to avoid infinite loops with zero-width matches
		if (m.index === regex.lastIndex) {
			regex.lastIndex++;
		}
		if(debug)
		// The result can be accessed through the `m`-variable.
		m.forEach((match, groupIndex) => {
			console.log(`Found match, group ${groupIndex}: ${match}`);
		});
		
		function extract(m, fn){
			return fn(m);
		}
		var resp = extract(m, fn);
		if(resp != undefined)
			list.push(resp);
	}
	return list;
}

function determineContentType(type){
	switch(type) {
		case "html":
			return "text/html";
		case "css":
			return "text/css";
		case "js":
			return "text/javascript";
		case "jpg":
		case "jpeg":
			return "image/jpeg"
		case "png":
		case "gif":
		case "bmp":
		case "webp":
		case "ico":
			return "image/" + type
		case "avi":
			return "video/webm";
		case "ogg":
			return "video/ogg";
		case "mp3":
			return "audio/mpeg";
		case "wav":
			return "audio/wav";
		default:
			return "text/plain";
	}
}

function saveData(filePath, data, encoding = "utf-8"){
	fs.appendFile(filePath, data, encoding, function(err){
		if(err) {
			console.log(err)
		} else {
			console.log("> Saved file '"+filePath+"' successfully!")
		}
	});
}

function getFrequency(name){
	if(name.contains("Every")){
		
		const regFreq = /Every(\d+)(mins|seconds|hours|days)/gi
		var it = execRegex(regFreq, name, function (m){
			var qty = m[1]
			var type = m[2]
			return {type: type.toLowerCase(), qty: qty};
		})[0];
		
		if(it){
			if(it.type == "mins") {
				return it.qty * 60 * 1000
			} else if(it.type == "seconds") {
				return it.qty * 1000
			} else if(it.type == "hours") {
				return it.qty * 60 * 60 * 1000
			} else if(it.type == "days") {
				return it.qty * 24 * 60 * 1000
			}
		}
		
	} else if(name.contains("Hourly")){
		return 60 * 60 * 1000
	} else if(name.contains("HalfHourly") || name.contains("HalfAnHour") ){
		return 30 * 60 * 1000
	} else if(name.contains("Daily")){
		return 24 * 60 * 60 * 1000
	} else {
		return 60 * 60 * 1000;
	}
}


String.prototype.contains = function(x){return this.indexOf(x) != -1}