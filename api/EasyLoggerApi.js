"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EasyLoggerApi = void 0;
const p_queue_1 = __importDefault(require("p-queue")); // v6.6.2 er viktig å bruke for denne 
//import moment from 'moment';
const luxon_1 = require("luxon");
const sheetsModule = require("@googleapis/sheets");
class EasyLoggerApi {
    /*

    Read requests

    Per day per project	Unlimited
    Per minute per project	300
    Per minute per user per project	60

    Write requests

    Per day per project	Unlimited
    Per minute per project	300
    Per minute per user per project	60
    */
    constructor(options) {
        this._commandQueue = new p_queue_1.default({ concurrency: 1, intervalCap: options.intervalCap, interval: 59000, throwOnTimeout: true, carryoverConcurrencyCount: true }); // max 60 pr 59 sekunder
        this._homey = options.homey;
        this._delimiter = options.delimiter;
        this._spreadsheetId = options.spreadsheetId;
        this._jwtClient = options.jwtClient;
        this._debug = options.debug === "true";
        this._debugProgress = options.debug === "progress";
        this._debugInvocation = options.debug === "invocation";
        this._logger = options.logger;
        this._errorlogger = options.errorlogger;
        this._timestampFormat = options.timestampFormat;
        this._timezone = options.timezone;
        this._fireAndForget = options.fireAndForget;
        this._retryOn404 = options.retryOn404;
        //this.sheets = google.sheets('v4');
        this.sheets = sheetsModule.sheets('v4');
        if (this._delimiter === undefined)
            this._delimiter = "|"; // default value
        //this.sheets = sheets4.sheets;
        // google.options({
        //   // All requests made with this object will use these settings unless overridden.
        //   //timeout: 70000,
        //   retryConfig: {
        //     retry : 6,
        //     retryDelay: 4900 // millisekunder
        //   }
        // });   
        this._logger("EasyLoggerApi constructed, delimiter:", this._delimiter, "_spreadsheetId:", this._spreadsheetId, "_debug:", this._debug, "intervalCap:", options.intervalCap);
        this._queuePending = this._commandQueue.pending;
        this._queueSize = this._commandQueue.size;
        this._queue_size_trigger = this._homey.flow.getTriggerCard("queuesize-changed");
        this._queue_size_trigger.trigger({ 'queuesize': this._commandQueue.size, 'pending': this._commandQueue.pending });
        this._logger(`_commandQueue ..  Size: ${this._commandQueue.size}  Pending: ${this._commandQueue.pending}`);
        //this._queue_size_trigger.trigger({'queuesize' : this._commandQueue.size, 'pending': this._commandQueue.pending});
        this._commandQueue.on('active', () => {
            if (this._queueSize != this._commandQueue.size) {
                if (this._debugProgress)
                    this._logger(`_commandQueue active ...  Size: ${this._commandQueue.size}  Pending: ${this._commandQueue.pending}`);
                this._queue_size_trigger.trigger({ 'queuesize': this._commandQueue.size, 'pending': this._commandQueue.pending });
                this._queuePending = this._commandQueue.pending;
                this._queueSize = this._commandQueue.size;
            }
        });
        // this._commandQueue.on('completed', () => {
        //     this._logger(`_commandQueue completed ...  Size: ${this._commandQueue.size}  Pending: ${this._commandQueue.pending}`);
        // });
        // this._commandQueue.on('empty', () => {
        //     this._logger(`_commandQueue empty ...  Size: ${this._commandQueue.size}  Pending: ${this._commandQueue.pending}`);
        // });
        this._commandQueue.on('error', (error) => {
            this._logger(`_commandQueue throwed some error ...  Size: ${this._commandQueue.size}  Pending: ${this._commandQueue.pending}`);
            this._logger("error : ", error);
        });
        this._commandQueue.on('idle', () => {
            if (this._debugProgress)
                this._logger(`_commandQueue idle ...  Size: ${this._commandQueue.size}  Pending: ${this._commandQueue.pending}`);
            this._queue_size_trigger.trigger({ 'queuesize': this._commandQueue.size, 'pending': this._commandQueue.pending });
            this._queuePending = this._commandQueue.pending;
            this._queueSize = this._commandQueue.size;
        });
    }
    async doEmptyQueue() {
        this._logger("doEmptyQueue values before: size=", this._commandQueue.size, "pending=", this._commandQueue.pending);
        this._commandQueue.clear();
        this._queuePending = this._commandQueue.pending;
        this._queueSize = this._commandQueue.size;
        this._logger("doEmptyQueue values after : size=", this._commandQueue.size, "pending=", this._commandQueue.pending);
        this._queue_size_trigger.trigger({ 'queuesize': this._commandQueue.size, 'pending': this._commandQueue.pending });
    }
    async doAppendMultiCelldelimitedValue(value) {
        // kalkulerer timestamp når hendelsen oppstår
        // og sender inn som parameter, siden selve operasjonen utføres 
        // en gang i framtiden 
        let _dato = this.getCurrentTimestampString();
        if (this._debug)
            this._logger("doAppendMultiCelldelimitedValue with ", value);
        //this._logger("+ dato", _dato);
        //this._logger.("+ value", value);
        //this._homey.setCapabilityValue('queue_size',this._commandQueue.size);
        var futurePromise = this._commandQueue.add(async () => {
            let rangeName = value['range-name'];
            let _delimited_data = value['delimited-data'];
            let useDate = true;
            var delimiter = this._delimiter;
            if (delimiter === undefined)
                this._logger("doAppendMultiCelldelimitedValue.delimiter===undefined");
            if (_delimited_data.startsWith('@NoDate' + delimiter)) {
                // shall not use date as prefix, just skipping it
                _delimited_data = _delimited_data.substring(8);
                useDate = false;
            }
            if (this._debug)
                this._logger("delimiter", delimiter, "this._delimiter", delimiter, "useDate", useDate);
            if (_delimited_data.indexOf('@Processed') > 1) {
                let _now = this.getCurrentTimestampString();
                _delimited_data = _delimited_data.replaceAll('@Processed', _now);
            }
            let splitted = _delimited_data.split(delimiter);
            //let data2 = _dato + this._delimiter;
            var data = (useDate ? [_dato] : []);
            if (this._debug)
                this._logger("array", data);
            for (let i = 0; i < splitted.length; i++) {
                let s = splitted[i];
                //this._logger.("s=",s);
                data.push(this.getFormattedWithNumberIfNeeded(s));
                //this._logger.("data_withDato",data);
            }
            //let data_withDato = _dato + this._delimiter + value['delimited-data'];
            const request = {
                spreadsheetId: this.retrieveSpreadsheetId(value),
                range: rangeName,
                valueInputOption: 'USER_ENTERED',
                insertDataOption: 'INSERT_ROWS',
                resource: {
                    "majorDimension": "ROWS",
                    "values": [data]
                },
                auth: this._jwtClient,
            };
            let lastHTTPStatusCode = null;
            for (let index = 1; index < 10; index++) {
                try {
                    await this.sheets.spreadsheets.values.append(request);
                    if (index > 1)
                        this._logger("doAppendMultiCelldelimitedValue done with success after " + (index - 1) + " attempts");
                    if (this._debugProgress)
                        this._logger("doAppendMultiCelldelimitedValue finished");
                    return;
                }
                catch (erro) {
                    let exception = erro;
                    if (this._debug)
                        this._logger(erro);
                    let sleeper = index * 5000;
                    if (sleeper > 30000)
                        sleeper = 30000; // maximum wait is 30 sek on each try
                    if (exception.response !== undefined) {
                        lastHTTPStatusCode = exception.response.status;
                        switch (exception.response.status) {
                            case 404:
                                if (this._retryOn404) {
                                    this._logger("code ", exception.response.status, "occurred, sleeping 5000 ms, attempt #", index, "doInsertMultiCelldelimitedValue with ", value);
                                    await this.sleep(5000);
                                    break;
                                } // else continue to default
                            case 403:
                            case 429:
                            case 500:
                            case 502:
                            case 503:
                                this._logger("code ", exception.response.status, "occurred, sleeping " + sleeper + " ms, doAppendMultiCelldelimitedValue with ", value);
                                await this.sleep(sleeper);
                                break;
                            default:
                                var err = "Uuups, statuscode " + exception.response.status + " occured: " + erro + " doAppendMultiCelldelimitedValue with " + JSON.stringify(value);
                                if (this._fireAndForget) {
                                    this._errorlogger(err);
                                    this._homey.notifications.createNotification({ excerpt: err }).catch((error1) => { this._errorlogger('Error sending notification: ' + error1.message); });
                                    return;
                                }
                                else {
                                    throw Error(err);
                                }
                        }
                        // if( 403 ===  exception.response.status  ||   ) {
                        //   this._logger("code 403 occurred, sleeping "+ sleeper+ " ms, doAppendMultiCelldelimitedValue with ", value);
                        //   await this.sleep(sleeper);
                        //   continue;
                        // }  
                        // if( 429 ===  exception.response.status) {
                        //   this._logger("code 429 occurred, sleeping "+ sleeper+ " ms, doAppendMultiCelldelimitedValue with ", value);
                        //   await this.sleep(sleeper);  
                        //   continue;
                        // } 
                        // if (503 ===  exception.response.status) {
                        //   this._logger("code 503 occurred, sleeping "+ sleeper+ " ms, doAppendMultiCelldelimitedValue with ", value);
                        //   await this.sleep(sleeper);    
                        //   continue;
                        // } 
                        // throw Error ("Uuups, statuscode "+ exception.response.status + " occured: " + erro )                                      
                        // if(403 ===  exception.response.status) {
                        //   this._logger("code 403 occurred, sleeping "+ sleeper+ " ms" + " queueSize=" +  this._commandQueue.size());
                        //   await this.sleep(sleeper);
                        // } else 
                        //   if(429 ===  exception.response.status) {
                        //     this._logger("code 429 occurred, sleeping "+ sleeper+ " ms" + " queueSize=" +  this._commandQueue.size());
                        //     await this.sleep(sleeper);  
                        //   } else {
                        //     throw Error ("Uuups, statuscode "+ exception.response.status + " occured: " + erro )
                        //   }
                    }
                    else {
                        // probably other error that should not be tried again
                        var err = "This did not go well, " + erro;
                        if (this._fireAndForget) {
                            this._errorlogger(err);
                            this._homey.notifications.createNotification({ excerpt: err }).catch((error1) => { this._errorlogger('Error sending notification: ' + error1.message); });
                            return;
                        }
                        else {
                            throw Error(err);
                        }
                    }
                }
            }
            // ikke vellykket selv etter 10 forsøk
            var err = "This did not go well, even after 10 attempts executing doAppendMultiCelldelimitedValue, last HTTP Status code was " + lastHTTPStatusCode + ", data= " + JSON.stringify(value);
            if (this._fireAndForget) {
                this._errorlogger(err);
                this._homey.notifications.createNotification({ excerpt: err }).catch((error1) => { this._errorlogger('Error sending notification: ' + error1.message); });
                return;
            }
            else {
                throw Error(err);
            }
        });
        if (this._debugProgress)
            this._logger("doAppendMultiCelldelimitedValue added 1, size = ", this._commandQueue.size);
        return futurePromise;
    }
    async doInsertMultiCelldelimitedValue(value) {
        if (this._debug)
            this._logger("doInsertMultiCelldelimitedValue with ", value);
        // kalkulerer timestamp når hendelsen oppstår
        // og sender inn som parameter, siden selve operasjonen utføres 
        // en gang i framtiden 
        let _dato = this.getCurrentTimestampString();
        //this._logger("+ dato", _dato);
        //this._logger("+ value", value);
        var futurePromise = this._commandQueue.add(async () => {
            //let _dato = this.getCurrentTimestampString();  
            //this._logger("dato", dt);
            this.retrieveSpreadsheetId(value);
            let _sheetId = parseInt(value['sheet-id']);
            let _rowNbr = parseInt(value['row-nbr']);
            let _columnNbr = parseInt(value['column-nbr']);
            let _delimited_data = value['delimited-data'];
            let useDate = true;
            var delimiter = this._delimiter;
            if (delimiter === undefined)
                this._logger("doInsertMultiCelldelimitedValue.delimiter===undefined");
            if (_delimited_data.startsWith('@NoDate' + delimiter)) {
                // shall not use date as prefix, just skipping it
                _delimited_data = _delimited_data.substring(8);
                useDate = false;
            }
            if (_delimited_data.indexOf('@Processed') > 1) {
                let _now = this.getCurrentTimestampString();
                _delimited_data = _delimited_data.replaceAll('@Processed', _now);
            }
            //this._logger("******");
            //this._logger("value=",value);
            let splitted = _delimited_data.split(delimiter);
            let data2 = (useDate ? _dato + delimiter : '');
            for (let i = 0; i < splitted.length; i++) {
                let s = splitted[i];
                //this._logger("s=",s);
                if (i < splitted.length - 1)
                    data2 += (this.getFormattedWithNumberIfNeeded(s) + delimiter);
                else
                    data2 += this.getFormattedWithNumberIfNeeded(s);
                //this._logger("data2",data2);
            }
            //let data = _dato + this._delimiter + value['delimited-data'];
            //this._logger("row-nbr ", _rowNbr, " delimited-data ", data);
            //this._logger("doInsertMultiCelldelimitedValue _columnNbr=",_columnNbr, " data=",data2  );
            const request = {
                spreadsheetId: this.retrieveSpreadsheetId(value),
                resource: {
                    requests: [
                        { insertRange: {
                                range: {
                                    sheetId: _sheetId,
                                    startRowIndex: _rowNbr - 1,
                                    endRowIndex: _rowNbr
                                },
                                shiftDimension: 'ROWS'
                            }
                        },
                        {
                            pasteData: {
                                data: data2,
                                type: 'PASTE_NORMAL',
                                delimiter: delimiter,
                                coordinate: {
                                    sheetId: _sheetId,
                                    rowIndex: _rowNbr - 1,
                                    columnIndex: _columnNbr - 1
                                }
                            }
                        }
                    ]
                },
                auth: this._jwtClient,
            };
            let lastHTTPStatusCode = null;
            for (let index = 1; index < 10; index++) {
                try {
                    await this.sheets.spreadsheets.batchUpdate(request);
                    if (index > 1)
                        this._logger("doInsertMultiCelldelimitedValue done with success after " + (index - 1) + " attempts");
                    return;
                }
                catch (erro) {
                    let exception = erro;
                    if (this._debug)
                        this._logger(erro);
                    let sleeper = index * 5000;
                    if (sleeper > 30000)
                        sleeper = 30000; // maximum wait is 30 sek on each try
                    if (exception.response !== undefined) {
                        lastHTTPStatusCode = exception.response.status;
                        if (exception.response !== undefined) {
                            switch (exception.response.status) {
                                case 404:
                                    if (this._retryOn404) {
                                        this._logger("code ", exception.response.status, "occurred, sleeping 5000 ms, attempt #", index, "doInsertMultiCelldelimitedValue with ", value);
                                        await this.sleep(5000);
                                        break;
                                    } // else continue to default
                                case 403:
                                case 429:
                                case 500:
                                case 502:
                                case 503:
                                    this._logger("code ", exception.response.status, "occurred, sleeping " + sleeper + " ms, doInsertMultiCelldelimitedValue with ", value);
                                    await this.sleep(sleeper);
                                    break;
                                default:
                                    var err = "Uuups, statuscode " + exception.response.status + " occured: " + erro + " doInsertMultiCelldelimitedValue with " + JSON.stringify(value);
                                    if (this._fireAndForget) {
                                        this._errorlogger(err);
                                        this._homey.notifications.createNotification({ excerpt: err }).catch((error1) => { this._errorlogger('Error sending notification: ' + error1.message); });
                                        return;
                                    }
                                    else {
                                        throw Error(err);
                                    }
                            }
                        }
                    }
                    else {
                        // probably other error that should not be tried again
                        var err = "This did not go well, " + erro;
                        if (this._fireAndForget) {
                            this._errorlogger(err);
                            this._homey.notifications.createNotification({ excerpt: err }).catch((error1) => { this._errorlogger('Error sending notification: ' + error1.message); });
                            return;
                        }
                        else {
                            throw Error(err);
                        }
                    }
                }
            }
            // ikke vellykket selv etter 10 forsøk
            var err = "This did not go well, even after 10 attempts executing doInsertMultiCelldelimitedValue, last HTTP Status code was " + lastHTTPStatusCode + ", data= " + JSON.stringify(value);
            if (this._fireAndForget) {
                this._errorlogger(err);
                this._homey.notifications.createNotification({ excerpt: err }).catch((error1) => { this._errorlogger('Error sending notification: ' + error1.message); });
                return;
            }
            else {
                throw Error(err);
            }
        });
        if (this._debugProgress)
            this._logger("doInsertMultiCelldelimitedValue added 1, size = ", this._commandQueue.size);
        return futurePromise;
    }
    async doUpdateMultiCelldelimitedValue(value) {
        if (this._debug)
            this._logger("doUpdateMultiCelldelimitedValue with ", value);
        // kalkulerer timestamp når hendelsen oppstår
        // og sender inn som parameter, siden selve operasjonen utføres 
        // en gang i framtiden 
        let _dato = this.getCurrentTimestampString();
        //this._logger("+ dato", _dato);
        //this._logger("+ value", value);
        var futurePromise = this._commandQueue.add(async () => {
            //let _dato = this.getCurrentTimestampString();  
            //this._logger("dato", dt);
            let _sheetId = parseInt(value['sheet-id']);
            let _rowNbr = parseInt(value['row-nbr']);
            let _columnNbr = parseInt(value['column-nbr']);
            let _delimited_data = value['delimited-data'];
            var delimiter = this._delimiter;
            if (delimiter === undefined)
                this._logger("doUpdateMultiCelldelimitedValue.delimiter===undefined");
            let useDate = true;
            if (_delimited_data.startsWith('@NoDate' + delimiter)) {
                // shall not use date as prefix, just skipping it
                _delimited_data = _delimited_data.substring(8);
                //this._logger("_delimited_data:"+_delimited_data);
                useDate = false;
            }
            if (_delimited_data.indexOf('@Processed') > 1) {
                let _now = this.getCurrentTimestampString();
                _delimited_data = _delimited_data.replaceAll('@Processed', _now);
            }
            //this._logger("******");
            //this._logger("value=",value);
            let splitted = _delimited_data.split(delimiter);
            let data2 = useDate ? _dato + delimiter : '';
            for (let i = 0; i < splitted.length; i++) {
                let s = splitted[i];
                //this._logger("s=",s);
                if (i < splitted.length - 1)
                    data2 += (this.getFormattedWithNumberIfNeeded(s) + delimiter);
                else
                    data2 += this.getFormattedWithNumberIfNeeded(s);
                //this._logger("data2",data2);
            }
            //let data = _dato + this._delimiter + value['delimited-data'];
            //this._logger("row-nbr ", _rowNbr, " delimited-data ", data);
            if (this._debug)
                this._logger("_columnNbr=" + _columnNbr + " _data=" + data2);
            const request = {
                spreadsheetId: this.retrieveSpreadsheetId(value),
                resource: {
                    requests: [
                        {
                            pasteData: {
                                data: data2,
                                type: 'PASTE_NORMAL',
                                delimiter: delimiter,
                                coordinate: {
                                    sheetId: _sheetId,
                                    rowIndex: _rowNbr - 1,
                                    columnIndex: _columnNbr - 1
                                }
                            }
                        }
                    ]
                },
                auth: this._jwtClient,
            };
            let lastHTTPStatusCode = null;
            for (let index = 1; index < 10; index++) {
                try {
                    await this.sheets.spreadsheets.batchUpdate(request);
                    if (index > 1)
                        this._logger("doUpdateMultiCelldelimitedValue done with success after " + (index - 1) + " attempts");
                    return;
                }
                catch (erro) {
                    let exception = erro;
                    if (this._debug)
                        this._logger(erro);
                    let sleeper = index * 5000;
                    if (sleeper > 30000)
                        sleeper = 30000; // maximum wait is 30 sek on each try
                    if (exception.response !== undefined) {
                        lastHTTPStatusCode = exception.response.status;
                        switch (exception.response.status) {
                            case 404:
                                if (this._retryOn404) {
                                    this._logger("code ", exception.response.status, "occurred, sleeping 5000 ms, attempt #", index, "doInsertMultiCelldelimitedValue with ", value);
                                    await this.sleep(5000);
                                    break;
                                } // else continue to default
                            case 403:
                            case 429:
                            case 500:
                            case 502:
                            case 503:
                                this._logger("code ", exception.response.status, "occurred, sleeping " + sleeper + " ms, doUpdateMultiCelldelimitedValue with ", value);
                                await this.sleep(sleeper);
                                break;
                            default:
                                var err = "Uuups, statuscode " + exception.response.status + " occured: " + erro + " doUpdateMultiCelldelimitedValue with " + JSON.stringify(value);
                                if (this._fireAndForget) {
                                    this._errorlogger(err);
                                    this._homey.notifications.createNotification({ excerpt: err }).catch((error1) => { this._errorlogger('Error sending notification: ' + error1.message); });
                                    return;
                                }
                                else {
                                    throw Error(err);
                                }
                        }
                    }
                    else {
                        // probably other error that should not be tried again
                        var err = "This did not go well, " + erro;
                        if (this._fireAndForget) {
                            this._errorlogger(err);
                            this._homey.notifications.createNotification({ excerpt: err }).catch((error1) => { this._errorlogger('Error sending notification: ' + error1.message); });
                            return;
                        }
                        else {
                            throw Error(err);
                        }
                    }
                }
            }
            // ikke vellykket selv etter 10 forsøk
            var err = "This did not go well, even after 10 attempts executing doUpdateMultiCelldelimitedValue, last HTTP Status code was " + lastHTTPStatusCode + ", data= " + JSON.stringify(value);
            if (this._fireAndForget) {
                this._errorlogger(err);
                this._homey.notifications.createNotification({ excerpt: err }).catch((error1) => { this._errorlogger('Error sending notification: ' + error1.message); });
                return;
            }
            else {
                throw Error(err);
            }
        });
        if (this._debugProgress)
            this._logger("doUpdateMultiCelldelimitedValue added 1, size = ", this._commandQueue.size);
        return futurePromise;
    }
    async doSetCellValue(value) {
        if (this._debug)
            this._logger("doSetCellValue with ", value);
        // kalkulerer timestamp når hendelsen oppstår
        // og sender inn som parameter, siden selve operasjonen utføres 
        // en gang i framtiden 
        let _dato = this.getCurrentTimestampString();
        //this._logger("+ dato", _dato);
        //this._logger("doSetCellValue value", value);
        var futurePromise = this._commandQueue.add(async () => {
            //this.log(dato + " : action card 'log-an-item' called with value ", value);
            let cellName = value['cell-name']; // se https://developers.google.com/sheets/api/guides/concepts#cell    
            let _delimited_data = value['delimited-data'];
            var delimiter = this._delimiter;
            if (delimiter === undefined)
                this._logger("doSetCellValue.delimiter===undefined");
            let useDate = true;
            if (_delimited_data.startsWith('@NoDate' + delimiter)) {
                // shall not use date as prefix, just skipping it
                _delimited_data = _delimited_data.substring(8);
                useDate = false;
            }
            var data = (useDate ? [_dato] : []);
            if (_delimited_data.indexOf('@Processed') > 1) {
                let _now = this.getCurrentTimestampString();
                _delimited_data = _delimited_data.replaceAll('@Processed', _now);
            }
            let splitted = _delimited_data.split(delimiter);
            for (let i = 0; i < splitted.length; i++) {
                let s = splitted[i];
                //this._logger("s=",s);
                data.push(this.getFormattedWithNumberIfNeeded(s));
                //this._logger("data_withDato",data_withDato);
            }
            if (this._debug)
                this._logger("data_withDato ", data);
            //this._logger("doSetCellValue data", data);
            const request = {
                spreadsheetId: this.retrieveSpreadsheetId(value),
                range: cellName,
                valueInputOption: 'USER_ENTERED',
                //insertDataOption: 'INSERT_ROWS',  
                resource: {
                    "majorDimension": "ROWS",
                    "values": [data]
                },
                auth: this._jwtClient,
            };
            let lastHTTPStatusCode = null;
            for (let index = 1; index < 10; index++) {
                try {
                    await this.sheets.spreadsheets.values.update(request);
                    if (index > 1)
                        this._logger("doSetCellValue done with success after " + (index - 1) + " attempts");
                    return;
                }
                catch (erro) {
                    let exception = erro;
                    if (this._debug)
                        this._logger(erro);
                    let sleeper = index * 5000;
                    if (sleeper > 30000)
                        sleeper = 30000; // maximum wait is 30 sek on each try
                    if (exception.response !== undefined) {
                        lastHTTPStatusCode = exception.response.status;
                        switch (exception.response.status) {
                            case 404:
                                if (this._retryOn404) {
                                    this._logger("code ", exception.response.status, "occurred, sleeping 5000 ms, attempt #", index, "doInsertMultiCelldelimitedValue with ", value);
                                    await this.sleep(5000);
                                    break;
                                } // else continue to default
                            case 403:
                            case 429:
                            case 500:
                            case 502:
                            case 503:
                                this._logger("code ", exception.response.status, "occurred, sleeping " + sleeper + " ms, doSetCellValue with ", value);
                                await this.sleep(sleeper);
                                break;
                            default:
                                var err = "Uuups, statuscode " + exception.response.status + " occured: " + erro + " doSetCellValue with " + JSON.stringify(value);
                                if (this._fireAndForget) {
                                    this._errorlogger(err);
                                    this._homey.notifications.createNotification({ excerpt: err }).catch((error1) => { this._errorlogger('Error sending notification: ' + error1.message); });
                                    return;
                                }
                                else {
                                    throw Error(err);
                                }
                        }
                    }
                    else {
                        // probably other error that should not be tried again
                        var err = "This did not go well, " + erro;
                        if (this._fireAndForget) {
                            this._errorlogger(err);
                            this._homey.notifications.createNotification({ excerpt: err }).catch((error1) => { this._errorlogger('Error sending notification: ' + error1.message); });
                            return;
                        }
                        else {
                            throw Error(err);
                        }
                    }
                }
            }
            // ikke vellykket selv etter 10 forsøk
            var err = "This did not go well, even after 10 attempts executing doSetCellValue, last HTTP Status code was " + lastHTTPStatusCode + ", data= " + JSON.stringify(value);
            if (this._fireAndForget) {
                this._errorlogger(err);
                this._homey.notifications.createNotification({ excerpt: err }).catch((error1) => { this._errorlogger('Error sending notification: ' + error1.message); });
                return;
            }
            else {
                throw Error(err);
            }
        });
        if (this._debugProgress)
            this._logger("doSetCellValue added 1, size = ", this._commandQueue.size);
        return futurePromise;
    }
    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    async doAddSheet(value) {
        if (this._debug)
            this._logger("doAddSheet with ", value);
        var futurePromise = this._commandQueue.add(async () => {
            let tabName = value['sheet-name'];
            const request = {
                spreadsheetId: this.retrieveSpreadsheetId(value),
                resource: {
                    requests: [
                        { addSheet: { properties: { title: tabName } } }
                    ]
                },
                auth: this._jwtClient,
            };
            let lastHTTPStatusCode = null;
            for (let index = 1; index < 10; index++) {
                try {
                    await this.sheets.spreadsheets.batchUpdate(request);
                    if (index > 1)
                        this._logger("doAddSheet done with success after " + (index - 1) + " attempts");
                    return;
                }
                catch (erro) {
                    let exception = erro;
                    if (this._debug)
                        this._logger(erro);
                    let sleeper = index * 5000;
                    if (sleeper > 30000)
                        sleeper = 30000; // maximum wait is 30 sek on each try
                    if (exception.response !== undefined) {
                        lastHTTPStatusCode = exception.response.status;
                        switch (exception.response.status) {
                            case 404:
                                if (this._retryOn404) {
                                    this._logger("code ", exception.response.status, "occurred, sleeping 5000 ms, attempt #", index, "doInsertMultiCelldelimitedValue with ", value);
                                    await this.sleep(5000);
                                    break;
                                } // else continue to default
                            case 400:
                                this._logger("code 400 occurred, assuming sheet ", value, "already exists");
                                return;
                            case 403:
                            case 429:
                            case 500:
                            case 502:
                            case 503:
                                this._logger("code ", exception.response.status, "occurred, sleeping " + sleeper + " ms, doAddSheet with ", value);
                                await this.sleep(sleeper);
                                break;
                            default:
                                var err = "Uuups, statuscode " + exception.response.status + " occured: " + erro + " doAddSheet with " + JSON.stringify(value);
                                if (this._fireAndForget) {
                                    this._errorlogger(err);
                                    this._homey.notifications.createNotification({ excerpt: err }).catch((error1) => { this._errorlogger('Error sending notification: ' + error1.message); });
                                    return;
                                }
                                else {
                                    throw Error(err);
                                }
                        }
                    }
                    else {
                        // probably other error that should not be tried again
                        var err = "This did not go well, " + erro;
                        if (this._fireAndForget) {
                            this._errorlogger(err);
                            this._homey.notifications.createNotification({ excerpt: err }).catch((error1) => { this._errorlogger('Error sending notification: ' + error1.message); });
                            return;
                        }
                        else {
                            throw Error(err);
                        }
                    }
                } // end-catch
            } // end for-loop
            // ikke vellykket selv etter 10 forsøk
            var err = "This did not go well, even after 10 attempts executing doAddSheet, last HTTP Status code was " + lastHTTPStatusCode + ", data= " + JSON.stringify(value);
            if (this._fireAndForget) {
                this._errorlogger(err);
                this._homey.notifications.createNotification({ excerpt: err }).catch((error1) => { this._errorlogger('Error sending notification: ' + error1.message); });
                return;
            }
            else {
                throw Error(err);
            }
        });
        if (this._debugProgress)
            this._logger("doAddSheet added 1, size = ", this._commandQueue.size);
        return futurePromise;
    }
    async doLogAnItem(value) {
        if (this._debug)
            this._logger("doLogAnItem with ", value);
        // kalkulerer timestamp når hendelsen oppstår
        // og sender inn som parameter, siden selve operasjonen utføres 
        // en gang i framtiden 
        let _dato = this.getCurrentTimestampString();
        //this._logger("+ dato", _dato);
        //this._logger("+ value", value);
        return this._commandQueue.add(async () => {
            let rangeName = value['range-name'];
            let data = this.getFormattedWithNumberIfNeeded(value['entry-data']);
            const request = {
                spreadsheetId: this.retrieveSpreadsheetId(value),
                range: rangeName,
                valueInputOption: 'USER_ENTERED',
                insertDataOption: 'INSERT_ROWS',
                resource: {
                    "majorDimension": "ROWS",
                    "values": [[_dato, data]]
                },
                auth: this._jwtClient,
            };
            await this.sheets.spreadsheets.values.append(request);
        });
    }
    async doSetAnItem(value) {
        if (this._debug)
            this._logger("doSetAnItem with ", value);
        // kalkulerer timestamp når hendelsen oppstår
        // og sender inn som parameter, siden selve operasjonen utføres 
        // en gang i framtiden 
        let _dato = this.getCurrentTimestampString();
        //this._logger("+ dato", _dato);
        //this._logger("+ value", value);
        return this._commandQueue.add(async () => {
            let rangeName = value['range-name'];
            let data = this.getFormattedWithNumberIfNeeded(value['entry-data']);
            const request = {
                spreadsheetId: this.retrieveSpreadsheetId(value),
                range: rangeName,
                valueInputOption: 'USER_ENTERED',
                resource: {
                    "values": [[_dato, data]]
                },
                auth: this._jwtClient,
            };
            await this.sheets.spreadsheets.values.update(request);
        });
    }
    async template(value) {
        // kalkulerer timestamp når hendelsen oppstår
        // og sender inn som parameter, siden selve operasjonen utføres 
        // en gang i framtiden 
        let _dato = this.getCurrentTimestampString();
        //this._logger("+ dato", _dato);
        //this._logger("+ value", value);
        return this._commandQueue.add(async () => {
        });
    }
    retrieveSpreadsheetId(value) {
        let v = value['spreadsheet-id'];
        if (v === undefined) {
            if (this._debug)
                this._logger("spreadsheet-id from value is not undefined, '" + v + "', using default: " + this._spreadsheetId);
            return this._spreadsheetId;
        }
        if (v.length < 10) {
            // propbaly not a valid spreadsheet, using default)
            if (this._debug)
                this._logger("spreadsheet-id from value is not valid, '" + v + "', using default: " + this._spreadsheetId);
            return this._spreadsheetId;
        }
        if (v.length > 10) {
            // probably a valid spreadsheet, using default)
            if (this._debug)
                this._logger("spreadsheet-id from value is valid, '" + v + "', using it");
            return v;
        }
        // always get something
        return this._spreadsheetId;
    }
    getFormattedWithNumberIfNeeded(input) {
        let s = input;
        //this._logger("s=",s);
        if (s.startsWith('#')) {
            s = s.substring(1).replaceAll('.', ',');
            //this._logger("s>",s);
        }
        return s;
    }
    getCurrentTimestampString() {
        //console.log("this._timestampFormat",this._timestampFormat);
        //let ts = moment().add(2,'hours').format(this._timestampFormat);
        let ts = luxon_1.DateTime.now().setZone(this._timezone).toFormat(this._timestampFormat);
        return ts;
        // console.log("ts",ts);
        //  let d = new Date();
        //  d.setHours(d.getHours()+1);
        //  return d.toISOString();
        // // typisk: 17.12.2022 kl. 18.07.41
        // //return d.getDate() + "." + (d.getMonth()+1) + "." + d.getFullYear() + " kl. " + d.getHours() + "." + d.getMinutes() + "." + d.getSeconds();
        // // 
        // return (d.getDate()<10 ? "0" + d.getDate() : d.getDate()) + 
        //   "." + 
        //   ((d.getMonth()+1) < 10 ? "0" + (d.getMonth()+1) : (d.getMonth()+1))+ 
        //   "." + 
        //   d.getFullYear() + 
        //   " " + 
        //   (d.getHours()< 10 ? "0" + d.getHours() : d.getHours()) + 
        //   "." + 
        //   (d.getMinutes()<10 ? "0" + d.getMinutes() : d.getMinutes()) + 
        //   "." + 
        //   (d.getSeconds()<10 ? "0" + d.getSeconds() : d.getSeconds());
    }
    async listOAuth2Info() {
        if (this._jwtClient !== undefined) {
            let accessToken = await this._jwtClient.getAccessToken();
            //api._logger("accessToken: ", accessToken['token'])
            let gToken = await this._jwtClient.gtoken;
            //api._logger("gToken: ", gToken)
            let s = '';
            s = accessToken['token'];
            let ss = await this._jwtClient.getTokenInfo(s);
            this._logger("Tokeninfo expiry_date ", ss);
            let ddd = new Date(ss['expiry_date']);
            this._logger("expiry_date ", ddd.toISOString());
        }
    }
}
exports.EasyLoggerApi = EasyLoggerApi;
