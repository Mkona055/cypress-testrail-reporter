"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TestRail = void 0;
var axios = require("axios");
var fs = require("fs");
var path = require("path");
var FormData = require("form-data");
var TestRailLogger = require("./testrail.logger");
var TestRailCache = require("./testrail.cache");
const chalk = require("chalk");
var TestRail = /** @class */ (function () {
    function TestRail(options) {
        this.options = options;
        this.includeAll = true;
        this.caseIds = [];
        this.base = options.host + "/index.php?/api/v2";
        this.runId;
    }
    TestRail.prototype.getCases =  function (suiteId,groupId) {
        var url = this.base + "/get_cases/" + this.options.projectId + "&suite_id=" + suiteId;
        if (groupId) {
            url += "&section_id=" + groupId;
        }
        if (this.options.filter) {
            url += "&filter=" + this.options.filter;
        }
        if (this.options.typeId) {
            url += "&type_id=" + this.options.typeId;
        }
        return axios({
            method: "get",
            url: url,
            headers: { "Content-Type": "application/json" },
            auth: {
                username: this.options.username,
                password: this.options.password,
            },
        })
            .then(function (response) {
            return response.data.cases.map(function (item) { return item.id; });
        })
            .catch(function (error) { return console.error(error); });
    };
    TestRail.prototype.createRun = async function (name, host, description, suiteId) {
        var _this = this;
        var _host = host;
        var listGroupIds = this.options.groupId;

        if (this.options.includeAllInTestRun === false) {
            this.includeAll = false;
            if (listGroupIds){
                var groupIDS = listGroupIds.split(',');
                for (let i = 0 ; i < groupIDS.length ; i++){
                    var subcaseids = await this.getCases(suiteId, groupIDS[i]);
                    this.caseIds = Array.prototype.concat(this.caseIds, subcaseids);
                }
            }else{
                this.caseIds = await this.getCases(suiteId, null)
            }

        }

        axios({
            method: "post",
            url: this.base + "/add_run/" + this.options.projectId,
            headers: { "Content-Type": "application/json" },
            auth: {
                username: this.options.username,
                password: this.options.password,
            },
            data: JSON.stringify({
                suite_id: suiteId,
                name: name,
                description: description,
                include_all: this.includeAll,
                case_ids: this.caseIds,
            }),
        })
            .then(function (response) {
            _this.runId = response.data.id;
            // cache the TestRail Run ID
            TestRailCache.store("runId", _this.runId);
            var path = "runs/view/" + _this.runId;
            TestRailLogger.log("Results are published to " + chalk.magenta(_host + "/index.php?/" + path));
        })
            .catch(function (error) { return console.error(error); });
    };
    TestRail.prototype.deleteRun = function () {
        this.runId = TestRailCache.retrieve("runId");
        axios({
            method: "post",
            url: this.base + "/delete_run/" + this.runId,
            headers: { "Content-Type": "application/json" },
            auth: {
                username: this.options.username,
                password: this.options.password,
            },
        }).catch(function (error) { return console.error(error); });
    };
    TestRail.prototype.publishResults = function (results) {
        this.runId = TestRailCache.retrieve("runId");
        var _res = results;
        return axios({
            method: "post",
            url: this.base + "/add_results_for_cases/" + this.runId,
            headers: { "Content-Type": "application/json" },
            auth: {
                username: this.options.username,
                password: this.options.password,
            },
            data: JSON.stringify({ results: results }),
        })
            .then(function (response) { return response.data; })
            .catch(function (error) {
                TestRailLogger.log("Test case "+_res[0].case_id+ " was not found in the test run");
        });
    };

    TestRail.prototype.uploadAttachment = function (resultId, path) {
        var form = new FormData();
        form.append("attachment", fs.createReadStream(path));
        return axios({
            method: "post",
            url: this.base + "/add_attachment_to_result/" + resultId,
            headers: __assign({}, form.getHeaders()),
            auth: {
                username: this.options.username,
                password: this.options.password,
            },
            data: form,
        });
    };
    // This function will attach failed screenshot on each test result(comment) if founds it
    TestRail.prototype.uploadScreenshots = function (caseId, resultId, _path) {
        var _this = this;
        var SCREENSHOTS_FOLDER_PATH = _path.replace(/e2e\/.*\//g,'screenshots/');

        fs.readdir(SCREENSHOTS_FOLDER_PATH, function (err, files) {
            if (err) {
                return console.log("Unable to scan screenshots folder: " + err);
            }
            files.forEach(function (file) {
                if (file.includes("C" + caseId) && /(failed|attempt)/g.test(file)) {
                    try {
                        _this.uploadAttachment(resultId, SCREENSHOTS_FOLDER_PATH +'/'+ file);
                    }
                    catch (err) {
                        console.log("Screenshot upload error: ", err);
                    }
                }
            });
        });
    };
    TestRail.prototype.uploadDownloads = function (caseId, resultId, _path) {
        var _this = this;
        var DOWNLOADS_FOLDER_PATH = _path.split('cypress')[0] + "cypress/downloads";

        fs.readdir(DOWNLOADS_FOLDER_PATH, function (err, files) {
            if (err) {
                return console.log("Unable to scan downloads folder: " + err);
            }
            files.forEach(function (file) {
                    try {
                        _this.uploadAttachment(resultId, DOWNLOADS_FOLDER_PATH +'/'+ file);
                    }
                    catch (err) {
                        console.log("Download upload error: ", err);
                    }

            });
        });
    };
    TestRail.prototype.uploadVideos = function (caseId, resultId, _path) {
        var _this = this;
        var VIDEOS_FOLDER_PATH = _path.replace(/e2e\/.*/g,'videos/');
        var vidName = _path.replace(/.*\//g,'');


        const { fork } = require('child_process');
        const child = fork(__dirname + '/publishVideo.js', {
              detached:true,
              stdio: 'inherit',
              env: Object.assign(process.env, {
                   vName:vidName,
                   vFolder:VIDEOS_FOLDER_PATH,
                   resId: resultId,
                   base:this.base,
                   username: this.options.username,
                   pwd: this.options.password
               })
        }).unref();

    };
    TestRail.prototype.closeRun = function () {
        this.runId = TestRailCache.retrieve("runId");
        axios({
            method: "post",
            url: this.base + "/close_run/" + this.runId,
            headers: { "Content-Type": "application/json" },
            auth: {
                username: this.options.username,
                password: this.options.password,
            },
        })
            .then(function () {
            TestRailLogger.log("Test run closed successfully");
        })
            .catch(function (error) { return console.error(error); });
    };
    return TestRail;
}());
exports.TestRail = TestRail;
