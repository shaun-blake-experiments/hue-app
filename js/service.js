/**
 * We need a way to access the urls to get a service ticket before we actually call them
 */
var SERVICE_URLS = {
		METRICS_VALIDATE_URL : 'https://nit.byu.edu/ry/webapp/nit/validate?target=https%3A%2F%2Fnit.byu.edu%2Fry%2Fwebapp%2Fnit%2Fcgi-bin%2Fmrtg-rrd.cgi%2F10015-day.json'
	};
	
var services = angular.module('networkTrafficApp.services', ['ngResource']);
services.factory('networkTrafficMetricsService', ['$resource',
	function($resource){
		return $resource(SERVICE_URLS.METRICS_VALIDATE_URL + "&ticket=:ticket", {}, {
			query: {method:'GET', params:{ticket:'@ticket'}, isArray:false}
		});
	}]
);

services.hueResponseTransformer = function(data, headers) {
	//Since the result we want is an object, but an error comes
	//as an array we need to mess with the error version since
	//angular resources need one type or the other.
	var parsedData = JSON.parse(data);
	if(angular.isArray(parsedData)) {
		//Convert [{blah}, {blah}] to {1: {blah}, 2: {blah}}
		var objectVersion = {};
		for (var i = 0; i < parsedData.length; ++i) {
			objectVersion[i] = parsedData[i];
		}
		return objectVersion;
	}
	else {
		return parsedData;
	}
}

services.factory('hueService', ['$resource',
	function($resource){
		return $resource('', {}, {
			status: {
				method:'GET',
				params:{hueIpAddress:'@hueIpAddress', username: '@username'},
				url: 'http://:hueIpAddress/api/:username',
				isArray: false,
				transformResponse: services.hueResponseTransformer
			},
			newUser: {
				method:'POST',
				params:{hueIpAddress:'@hueIpAddress'},
				url: 'http://:hueIpAddress/api',
				isArray: true
			},
			setLightState: {
				method:'PUT',
				params:{hueIpAddress:'@hueIpAddress', lightNumber:'@lightNumber'},
				isArray:true,
				url: 'http://:hueIpAddress/api/newdeveloper/lights/:lightNumber/state'
			}
		});
	}]
);