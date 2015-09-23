//I can't figure out how to remove the alarm listener
//So everytime the controller is loaded (from navigating the routes)
//the listeners keep adding up.
//This global variable is just a quick hack to avoid it.
var alarmSet = false;
angular.module('networkTrafficApp.controllers', ['ngRoute'])
	
	.config(function($routeProvider) {
		$routeProvider
			.when('/status', {
				controller: 'StatusCtrl',
				templateUrl: chrome.runtime.getURL('templates/status.html')
			})
			.when('/settings', {
				controller: 'StatusCtrl',
				templateUrl: chrome.runtime.getURL('templates/settings.html')
			})
			.when('/login', {
				controller: 'StatusCtrl',
				templateUrl: chrome.runtime.getURL('templates/login.html')
			})
			.otherwise({
				redirectTo:'/status'
			});
	})

	.controller('MainCtrl', ['$scope', '$http', '$location', function($scope, $http, $location) {
		
		var NOTIFICATION_TYPES = {
			ERROR : 'ERROR'
		};
		
		$scope.STATUS_COLORS = {
			CRITICAL : {color: 'red', hue: 0},
			WARNING : {color: 'yellow', hue: 12750},
			GOOD : {color: 'green', hue: 25500}
		};
		
		$scope.HUE_STATES = {
			CONNECTED : {label: "Hue Connected", class: "label-success", icon_class: ""},
			CONNECTING : {label: "Connecting...", class: "label-warning", icon_class: "fa-spin"},
			NOT_CONNECTED : {label: "Hue Not Connected", class: "label-danger", icon_class: ""},
			NOT_CONFIGURED : {label: "Hue Settings Not Configured", class: "label-danger", icon_class: ""},
			NOT_AUTHORIZED : {label: "Hue Not Authorized - Check Settings", class: "label-danger", icon_class: ""},
			AUTHORIZING : {label: "Authorizing... Press Button on Hub", class: "label-warning", icon_class: "fa-spin"}
		};
		
		$scope.status = {};
		
		$scope.changeColor = function(direction, color) {
			if(direction && color) {
				if(direction == 'inbound') {
					$scope.status.inboundColor = color;
				}
				else if(direction == 'outbound') {
					$scope.status.outboundColor = color;
				}
			}
		};
		
		$scope.showPage = function (page) {
			$location.path("/" + page);
		};
		
		chrome.storage.sync.get('settings', function(value) {
			$scope.$apply(function() {
				load(value);

				$scope.$watch("settings", function(newValue, oldValue) {
					save();
				}, true);
			});
		});
		
		// If there is saved data in storage, use it. Otherwise, bootstrap with defaults
		var load = function(value) {
			if (value && value.settings) {
				$scope.settings = value.settings;
			} else {
				$scope.settings = {
					hueIpAddress: "",
					inboundHueLightNumber: null,
					outboundHueLightNumber: null,
					showHueStatus: false,
					showHueSettings: true,
					showDebug: false,
					tgt: null,
					polling: null
				};
			}
			
			$scope.notifications = [];
		};
		
		$scope.showError = function(status, shortError, longError) {
			$scope.notifications.push({type: NOTIFICATION_TYPES.ERROR, shortError: shortError, longError: longError});
		};
		
		$scope.dismissNotification = function(index) {
			if(index < $scope.notifications.length) {
				$scope.notifications.splice(index, 1);
			}
		};
		
		var save = function() {
			if($scope.settings) {
				chrome.storage.sync.set({'settings': $scope.settings
				});
			}
		};
		
		// See http://victorblog.com/2012/12/20/make-angularjs-http-service-behave-like-jquery-ajax/
		var makeAngularHttpBehaveLikeJquery = function() {
			$http.defaults.headers.post['Content-Type'] = 'application/x-www-form-urlencoded;charset=utf-8';
			
			/**
			* The workhorse; converts an object to x-www-form-urlencoded serialization.
			* @param {Object} obj
			* @return {String}
			*/
			var param = function(obj) {
				var query = '', name, value, fullSubName, subName, subValue, innerObj, i;
				
				for(name in obj) {
					value = obj[name];
					
					if(value instanceof Array) {
					for(i=0; i<value.length; ++i) {
						subValue = value[i];
						fullSubName = name + '[' + i + ']';
						innerObj = {};
						innerObj[fullSubName] = subValue;
						query += param(innerObj) + '&';
					}
				}
				else if(value instanceof Object) {
					for(subName in value) {
						subValue = value[subName];
						fullSubName = name + '[' + subName + ']';
						innerObj = {};
						innerObj[fullSubName] = subValue;
						query += param(innerObj) + '&';
					}
				}
				else if(value !== undefined && value !== null)
					query += encodeURIComponent(name) + '=' + encodeURIComponent(value) + '&';
				}
			
				return query.length ? query.substr(0, query.length - 1) : query;
			};
			// Override $http service's default transformRequest
			$http.defaults.transformRequest = [function(data) {
				return angular.isObject(data) && String(data) !== '[object File]' ? param(data) : data;
			}];
		};
		
		//Start stuff that doesn't need to wait until the settings have been loaded
		makeAngularHttpBehaveLikeJquery();
	}])
	
	.controller('StatusCtrl', ['$scope', 'networkTrafficMetricsService', 'hueService', '$http', function($scope, networkTrafficMetricsService, hueService, $http) {
		
		var CAS_REST_BASE_URL = "https://cas.byu.edu/cas/v1/tickets";
		var HUE_USER_NAME = "networkTrafficApp";
		//var HUE_USER_NAME = "newdeveloper";
		
		$scope.$watch("status.trafficMetrics", function(newMetrics, oldMetrics) {
			if(newMetrics && newMetrics.$resolved) {
				parseMetrics(newMetrics);
			}
		}, true);
		
		$scope.$watch("status.inboundColor", function(newColor, oldColor) {
			if(newColor && newColor != oldColor) {
				syncHue();
			}
		});
		$scope.$watch("status.outboundColor", function(newColor, oldColor) {
			if(newColor && newColor != oldColor) {
				syncHue();
			}
		});
		
		var parseMetrics = function(metrics) {
			var inboundIndex = determineIndexOfType(metrics.system.metrics, 'inbound');
			var outboundIndex = determineIndexOfType(metrics.system.metrics, 'outbound');
			
			$scope.status.inboundCriticalThreshold = metrics.system.metrics[inboundIndex].upper_critical_threshold;
			$scope.status.outboundCriticalThreshold = metrics.system.metrics[outboundIndex].upper_critical_threshold;
			$scope.status.inboundWarningThreshold = metrics.system.metrics[inboundIndex].upper_warning_threshold;
			$scope.status.outboundWarningThreshold = metrics.system.metrics[outboundIndex].upper_warning_threshold;
			$scope.status.inboundUnitOfMeasure = metrics.system.metrics[inboundIndex].unit_of_measure;
			$scope.status.outboundUnitOfMeasure = metrics.system.metrics[outboundIndex].unit_of_measure;
			
			//The status field is hardcoded to good in the service code, so we need to manually calculate it
			
			var inboundValues = metrics.system.metrics[inboundIndex].historical_decimal_values;
			var outboundValues = metrics.system.metrics[outboundIndex].historical_decimal_values;
			//The most recent metric can have an undefined value, so loop until we find one
			var latestInboundIndex = inboundValues.length -1;
			for(; latestInboundIndex > 0; latestInboundIndex--) {
				var inboundMetric = inboundValues[latestInboundIndex];
				if(inboundMetric.decimal_value) {
					$scope.status.lastestInboundMetric = inboundMetric;
					break;
				}
			}
			var latestOutboundIndex = outboundValues.length -1;
			for(; latestOutboundIndex > 0; latestOutboundIndex--) {
				var outboundMetric = outboundValues[latestOutboundIndex];
				if(outboundMetric.decimal_value) {
					$scope.status.lastestOutboundMetric = outboundMetric;
					break;
				}
			}
			
			//Inbound
			if($scope.status.lastestInboundMetric.decimal_value >= $scope.status.inboundCriticalThreshold) {
				$scope.status.inboundColor = $scope.STATUS_COLORS.CRITICAL;
			} else if($scope.status.lastestInboundMetric.decimal_value >= $scope.status.inboundWarningThreshold) {
				$scope.status.inboundColor = $scope.STATUS_COLORS.WARNING;
			}
			else {
				$scope.status.inboundColor = $scope.STATUS_COLORS.GOOD;
			}
			
			//Outbound
			if($scope.status.lastestOutboundMetric.decimal_value >= $scope.status.outboundCriticalThreshold) {
				$scope.status.outboundColor = $scope.STATUS_COLORS.CRITICAL;
			} else if($scope.status.lastestOutboundMetric.decimal_value >= $scope.status.outboundWarningThreshold) {
				$scope.status.outboundColor = $scope.STATUS_COLORS.WARNING;
			}
			else {
				$scope.status.outboundColor = $scope.STATUS_COLORS.GOOD;
			}
		};
		
		/**
		 * We could assume the inbound is always 0 and outbound is always 1, but just to be sure...
		 */
		var determineIndexOfType = function(metricsList, type) {
			var index;
			angular.forEach(metricsList, function(value, key){
				if(value.display_name == type) {
					index = key;
				}
			}, index);
			return index;
		};
		
		$scope.handleLogin = function() {
			var netid = $scope.user.netid;
			var password = $scope.user.password;
			
			$scope.user.password = "";
			
			getTicketGrantingTicket(function success() {
				$scope.showPage('status');
			}, netid, password);
		};
	
		/**
		 * Uses the CAS rest api to get a ticket granting ticket. If no username
		 * and password are given, it will redirect to the login page.
		 */
		var getTicketGrantingTicket = function(success, netid, password) {
			if(!netid || !password) {
				$scope.showPage('login');
				return;
			}
			$scope.user.loggingIn = true;
			$http.post(CAS_REST_BASE_URL, {username:netid, password: password}).
			success(function(data, status) {
				$scope.user.loggingIn = true;
				var tgt = data.match(/\/TGT.*-cas/)[0];
				$scope.settings.tgt = tgt.replace("/", "");
				if(typeof(success) == typeof(Function)) {
					success();
				}
			}).
			error(function(data, status) {
				$scope.showError(status, "Authentication Error", "Please check your login and try again. Sorry about making you hit the x button...");
				$scope.user.loggingIn = false;
			});
		};
		
		$scope.$watch("settings.tgt", function(newValue, oldValue) {
			if(!newValue && oldValue) {
				deleteTicketGrantingTicket(oldValue);
			}
		});
		
		/**
		 * Uses the CAS rest api to delete a given ticket granting ticket.
		 */
		var deleteTicketGrantingTicket = function(tgt) {
			$scope.status.networkMetricsCall = true;
			$http.delete(CAS_REST_BASE_URL + "/" + tgt).
			success(function(data, status) {
				$scope.status.networkMetricsCall = false;
			}).
			error(function(data, status) {
				$scope.status.networkMetricsCall = false;
				$scope.showError(status, "Error Deleting TGT", "Status: " + status + " Data: " + data);
			});
		};
		
		var getServiceTicket = function(serviceUrl, success) {
			$scope.status.networkMetricsCall = true;
			$http.post(CAS_REST_BASE_URL + "/" + $scope.settings.tgt, {service: serviceUrl}).
			success(function(data, status) {
				$scope.status.networkMetricsCall = false;
				if(typeof(success) == typeof(Function)) {
					success(data);
				}
			}).
			error(function(data, status) {
				$scope.status.networkMetricsCall = false;
				if(status == 404) {
					$scope.settings.tgt = null;
					//TODO Possible infinite loop on error here.  Probably need
					//some better handling to avoid continual retry.
					getTrafficMetrics();
					return;
				}
				else {
					$scope.showError(status, "Service Error", "There was an error calling the network metrics service.");
				}
			});
		};
		
		/**
		 * Call the traffic metrics service with the existing service ticket
		 * or get a new one first if needed.
		 */
		var getTrafficMetrics = function() {
			if(!$scope.settings.tgt) {
				getTicketGrantingTicket(function success() {
					getServiceTicket(SERVICE_URLS.METRICS_VALIDATE_URL, makeTrafficMetricsCall);
				});
			}
			else {
				getServiceTicket(SERVICE_URLS.METRICS_VALIDATE_URL, makeTrafficMetricsCall);
			}
		};
		
		/**
		 * Get the traffic metrics with the already set service ticket
		 */
		var makeTrafficMetricsCall = function(serviceTicket) {
			$scope.status.networkMetricsCall = true;
			$scope.status.trafficMetrics = networkTrafficMetricsService.query(
				{ticket:serviceTicket},
				function success(value, responseHeaders) {
					syncHue();
					$scope.status.networkMetricsCall = false;
				},
				function error(httpResponse) {
					$scope.showError(status, "Traffic Metrics Service Error", "There was an error calling the traffic metrics service.");
					$scope.status.networkMetricsCall = false;
				}
			);
		};
		
		var syncHue = function() {
			if($scope.status.hueState == $scope.HUE_STATES.CONNECTED) {
				changeHueColor($scope.settings.inboundHueLightNumber, $scope.status.inboundColor);
				changeHueColor($scope.settings.outboundHueLightNumber, $scope.status.outboundColor);
			}
		};
		
		$scope.setHueState = function() {
			if($scope.isHueConfigured()) {
				//reset the status so the ui can show a loading icon
				$scope.status.hueState = $scope.HUE_STATES.CONNECTING;
				hueService.status({hueIpAddress:$scope.settings.hueIpAddress, username: HUE_USER_NAME},
					function success(value, responseHeaders) {
						//An error response will be in the form {0: {error: {...}}}
						//Not handling multiple error results
						if(value[0]) {
							var error = value[0].error;
							//Note Authorized
							if(error.type == 1) {
								$scope.status.hueState = $scope.HUE_STATES.NOT_AUTHORIZED;
							}
							else {
								$scope.showError(status, "Hue Error", "There was an error attempting to connect to the Hue hub. Type: " + error.type + " Description: " + error.description);
								$scope.status.hueState = $scope.HUE_STATES.NOT_CONNECTED;
							}
						}
						else if(angular.isObject(value)) {
							$scope.status.hueState = $scope.HUE_STATES.CONNECTED;
							$scope.status.hueStatus = value;
						}
					},
					function error(httpResponse) {
						$scope.showError(status, "Hue Error", "There was an error attempting to connect to the Hue hub. You might need to check your settings.");
						$scope.status.hueState = $scope.HUE_STATES.NOT_CONNECTED;
					}
				);
			}
			else {
				$scope.status.hueState = $scope.HUE_STATES.NOT_CONFIGURED;
			}
		};
		
		$scope.isHueConfigured = function() {
			return $scope.settings.hueIpAddress && $scope.settings.inboundHueLightNumber && $scope.settings.outboundHueLightNumber;
		};
		
		$scope.authorizeHue = function() {
			//todo -- we could poll here but we I can't get the listener off the alarms
			//and the shortest period is 1 minute...
			$scope.status.hueState = $scope.HUE_STATES.AUTHORIZING;
			hueService.newUser(
				//URL Parameters
				{
					hueIpAddress: $scope.settings.hueIpAddress
				},
				//JSON Body
				JSON.stringify({"devicetype":"Chrome Application","username":HUE_USER_NAME}),
				function success(value, responseHeaders) {
					//Expected one element in the array in either case
					var result = value[0];
					if(result.success) {
						//todo -- better messaging
						$scope.showError(status, "Success", "The application has been authorized with the hub.");
						$scope.showPage("status");
						return;
					}
					else if(result.error && result.error.type == 101) {
						//This is expected... we just wait for them to push the button then push the "I've pushed the button" button
						return;
					}
					else{
						$scope.showError(status, "Hue Error", "There was an error attempting to authorize with the Hue hub.");
						console.error("Error value: ");
						console.error(value);
					}
				},
				function error(httpResponse) {
					$scope.showError(status, "Hue Error", "There was an error attempting to authorize with the Hue hub.");
				}
			);
		};
		
		$scope.cancelAuthorizeHue = function() {
			$scope.status.hueState = $scope.HUE_STATES.NOT_AUTHORIZED;
		};
		
		$scope.hueButtonPressed = function() {
			hueService.newUser(
				//URL Parameters
				{
					hueIpAddress: $scope.settings.hueIpAddress
				},
				//JSON Body
				JSON.stringify({"devicetype":"Chrome Application","username":HUE_USER_NAME}),
				function success(value, responseHeaders) {
					//Expected one element in the array in either case
					var result = value[0];
					if(result.success) {
						//todo -- better messaging
						$scope.showError(status, "Success", "The application has been authorized with the hub.");
						$scope.showPage("status");
						return;
					}
					else if(result.error && result.error.type == 101) {
						$scope.showError(status, "Hue Error", "There was an error attempting to authorize with the Hue hub. You might want to press the button again.");
						console.error("Error value: ");
						console.error(value);
					}
					else{
						$scope.showError(status, "Hue Error", "There was an error attempting to authorize with the Hue hub.");
						console.error("Error value: ");
						console.error(value);
					}
				},
				function error(httpResponse) {
					$scope.showError(status, "Hue Error", "There was an error attempting to authorize with the Hue hub.");
				}
			);
		};
		
		/**
		 * Color parameter is one of the STATUS_COLORS enums
		 */
		var changeHueColor = function(lightNumber, color) {
			if(!color) {
				return;
			}
			hueService.setLightState(
				//URL Parameters
				{
					hueIpAddress: $scope.settings.hueIpAddress,
					lightNumber: lightNumber
				},
				//JSON Body
				JSON.stringify({on: true, sat: 255, bri: 255, hue: color.hue}),
				function(data) {
					//TODO -- handle success or error
				}
			);
		};
		
		/**
		 * This is used to determine which of the images to use.
		 * Because I couldn't dynamically load the images within a template
		 * I just had to load them all normally and hide or show them based
		 * on this function.
		 */
		$scope.shouldShowStatus = function (direction, color) {
			if(direction == "inbound" && color == $scope.status.inboundColor) {
				return true;
			}
			else if(direction == "outbound" && color == $scope.status.outboundColor) {
				return true;
			}
		};
		
		/**
		 * This version seems to work well the first time but authorization fails
		 * after that. I'll leave this old method in here just for interest in
		 * doing it this way.
		 */
		var getNewServiceTicketIdentityWebAuthFlow = function() {
			var webAuthUrl = "https://cas.byu.edu/cas/login?service=https://badmhkehkamifbkjjciahfodgmpbjgjm.chromiumapp.org/result";
			chrome.identity.launchWebAuthFlow(
				{'url': webAuthUrl, 'interactive': true},
				function(redirect_url) {
					var ticket = redirect_url.match(/\?ticket=.*/)[0];
					$scope.settings.serviceTicket = ticket.replace("?ticket=", "");
				}
			);
		};
		
		var alarmListener = function (alarm) {
			getTrafficMetrics();
		};
		
		/**
		 * This seems like it should work. For some reason the alarm listener
		 * doesn't get removed so it keeps adding more listeners as
		 * you go over to the settings and back.
		 * For that reason I took off the links that changed the polling.
		 */
		/*$scope.$watch("settings.polling", function(newValue, oldValue) {
			if($scope.settings.polling) {
				chrome.alarms.clearAll();
				chrome.alarms.onAlarm.removeListener(alarmListener);
				
				getTrafficMetrics();
				
				chrome.alarms.onAlarm.addListener(alarmListener);
				chrome.alarms.create("getTrafficMetrics", {delayInMinutes: 1, periodInMinutes: 1} );
			}
			else {
				chrome.alarms.clearAll();
				chrome.alarms.onAlarm.removeListener(alarmListener);
			}
		});*/
		
		$scope.setHueState();
		//This will trigger the watch which will kick off the metric grabbing polling
		$scope.settings.polling = true;
		//But since I couldn't get that to work (see commented out watch on the settings.polling)...
		//Just set it up one time (and avoid multiples by check a global variable)
		if(!alarmSet) {
			getTrafficMetrics();
			chrome.alarms.create("getTrafficMetrics", {delayInMinutes: 1, periodInMinutes: 1} );
			chrome.alarms.onAlarm.addListener(alarmListener);
			alarmSet = true;
		}
	}]);