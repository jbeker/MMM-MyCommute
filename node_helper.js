/* Magic Mirror
 * Module: mrx-work-traffic
 *
 * By Dominic Marx
 * MIT Licensed.
 */

var NodeHelper = require("node_helper");
var request = require('request');
var moment = require('moment');

module.exports = NodeHelper.create({
    travelModes: [
        'driving',
        'walking',
        'bicycling',
        'transit'
    ],

    transitModes: [
        'bus',
        'subway',
        'train',
        'tram',
        'rail'
    ],


    avoidOptions: [
        'tolls',
        'highways',
        'ferries',
        'indoor'
    ],

    start: function () {
        console.log("====================== Starting node_helper for module [" + this.name + "]");
    },


    // subclass socketNotificationReceived
    socketNotificationReceived: function (notification, payload) {
        if (notification === 'GOOGLE_TRAFFIC_GET') {

            //first data opull after new config
            this.getPredictions(payload);

        }
    },

    getPredictions: function (payload) {
        var self = this;
        var predictions = new Array();
        var returned = 0;

        payload.destinations.forEach(function (dest, index) {

            if (dest.config.geoJSON) {
                console.log('GeoJSON: ' + dest.config.geoJSON)

                self.getGeoJSON(dest.config.geoJSON, function (geojson) {

                    var lastLocation = geojson.payload.pop();

                    self.getReverseGeoCoding(lastLocation.lat, lastLocation.lon, dest.global_config.apiKey, function (address) {
                        dest.config.destination = address.payload.plus_code.compound_code;

                        var url = 'https://maps.googleapis.com/maps/api/directions/json' + self.getParams(dest);
                        console.log(url);
                        self.getAddress(url, dest, function (prediction) {
                            prediction['locations'] = address.payload;
                            predictions[index] = prediction;
                            returned++;

                            if (returned == payload.destinations.length) {
                                self.sendSocketNotification('GOOGLE_TRAFFIC_RESPONSE' + payload.instanceId, predictions);
                            };
                        });
                    })
                })
            }
            else {
                console.log('Normal address: ' + dest.config.destination)

                var url = 'https://maps.googleapis.com/maps/api/directions/json' + self.getParams(dest);
                console.log(url);
                self.getAddress(url, dest, function (prediction) {
                    predictions[index] = prediction;
                    returned++;

                    if (returned == payload.destinations.length) {
                        self.sendSocketNotification('GOOGLE_TRAFFIC_RESPONSE' + payload.instanceId, predictions);
                    };
                });
            }



        });
    },
    getReverseGeoCoding: function name(lat, long, apiKey, callback) {
        var url = 'https://maps.googleapis.com/maps/api/geocode/json?latlng=' + lat + ',' + long + '&key=' + apiKey

        request({ url: url, method: 'GET' }, function (error, response, body) {
            address_response = new Object();

            if (!error && response.statusCode == 200) {
                address_response.payload = JSON.parse(body);
            }
            else {
                console.log("Error getting traffic prediction: " + response.statusCode);
                address_response.error = true;
            }

            callback(address_response)
        })
    },
    getGeoJSON: function name(geojson_url, callback) {
        request({ url: geojson_url, method: 'GET' }, function (error, response, body) {
            json_response = new Object();

            if (!error && response.statusCode == 200) {
                json_response.payload = JSON.parse(body);
            }
            else {
                console.log("Error getting traffic prediction: " + response.statusCode);
                json_response.error = true;
            }

            callback(json_response)
        })
    },
    getAddress: function (url, dest, callback) {
        request({ url: url, method: 'GET' }, function (error, response, body) {

            var prediction = new Object({
                config: dest.config
            });

            if (!error && response.statusCode == 200) {

                var data = JSON.parse(body);


                if (data.error_message) {
                    console.log("MMM-MyCommute: " + data.error_message);
                    prediction.error = true;
                } else {

                    var routeList = new Array();
                    for (var i = 0; i < data.routes.length; i++) {
                        var r = data.routes[i];
                        var routeObj = new Object({
                            summary: r.summary,
                            time: r.legs[0].duration.value
                        });

                        if (r.legs[0].duration_in_traffic) {
                            routeObj.timeInTraffic = r.legs[0].duration_in_traffic.value;
                        }
                        if (dest.config.mode && dest.config.mode == 'transit') {
                            var transitInfo = new Array();
                            var gotFirstTransitLeg = false;
                            for (var j = 0; j < r.legs[0].steps.length; j++) {
                                var s = r.legs[0].steps[j];

                                if (s.transit_details) {
                                    var arrivalTime = '';
                                    if (!gotFirstTransitLeg && dest.config.showNextVehicleDeparture) {
                                        gotFirstTransitLeg = true;
                                        // arrivalTime = ' <span class="transit-arrival-time">(next at ' + s.transit_details.departure_time.text + ')</span>';
                                        arrivalTime = moment(s.transit_details.departure_time.value * 1000);
                                    }
                                    transitInfo.push({ routeLabel: s.transit_details.line.short_name ? s.transit_details.line.short_name : s.transit_details.line.name, vehicle: s.transit_details.line.vehicle.type, arrivalTime: arrivalTime });
                                }
                                routeObj.transitInfo = transitInfo;
                            }
                        }
                        routeList.push(routeObj);
                    }
                    prediction.routes = routeList;

                }

            } else {
                console.log("Error getting traffic prediction: " + response.statusCode);
                prediction.error = true;

            }

            callback(prediction);

        });
    },
    getParams: function (dest) {
        var params = '?';
        params += 'origin=' + encodeURIComponent(dest.global_config.origin);
        params += '&destination=' + encodeURIComponent(dest.config.destination);
        params += '&key=' + dest.global_config.apiKey;

        //travel mode
        var mode = 'driving';
        if (dest.mode && this.travelModes.indexOf(dest.mode) != -1) {
            mode = dest.mode;
        }
        params += '&mode=' + mode;

        //transit mode if travelMode = 'transit'
        if (mode == 'transit' && dest.transitMode) {
            var tModes = dest.transitMode.split("|");
            var sanitizedTransitModes = '';
            for (var i = 0; i < tModes.length; i++) {
                if (this.transitModes.indexOf(tModes[i]) != -1) {
                    sanitizedTransitModes += (sanitizedTransitModes == '' ? tModes[i] : "|" + tModes[i]);
                }
            }
            if (sanitizedTransitModes.length > 0) {
                params += '&transit_mode=' + sanitizedTransitModes;
            }
        }
        if (dest.alternatives == true) {
            params += '&alternatives=true';
        }

        if (dest.waypoints) {
            var waypoints = dest.waypoints.split("|");
            for (var i = 0; i < waypoints.length; i++) {
                waypoints[i] = "via:" + encodeURIComponent(waypoints[i]);
            }
            params += '&waypoints=' + waypoints.join("|");
        }

        //avoid
        if (dest.avoid) {
            var a = dest.avoid.split("|");
            var sanitizedAvoidOptions = '';
            for (var i = 0; i < a.length; i++) {
                if (this.avoidOptions.indexOf(a[i]) != -1) {
                    sanitizedAvoidOptions += (sanitizedAvoidOptions == '' ? a[i] : "|" + a[i]);
                }
            }
            if (sanitizedAvoidOptions.length > 0) {
                params += '&avoid=' + sanitizedAvoidOptions;
            }

        }

        params += '&departure_time=now'; //needed for time based on traffic conditions

        return params;

    }

});
