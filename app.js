"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const homey_1 = __importDefault(require("homey"));
//import {google} from 'googleapis';
const google_auth_library_1 = require("google-auth-library");
const EasyLoggerApi_1 = require("./api/EasyLoggerApi");
class EasyLoggerApp extends homey_1.default.App {
    /*
  
          const control_state_card_trigger = this.homey.flow.getTriggerCard("fan-speed-changed")
  
        control_state_card_trigger.trigger({'fan-speed':toValue});
  
    */
    async onInit() {
        this.log('Homey Easy Logger has been initialized');
        this.intervalCap = 59; // default value
        this.timestampFormat = this.homey.settings.get('timestampFormat');
        this.log("timestampFormat: '" + this.timestampFormat + "'");
        if (this.timestampFormat === null) {
            this.timestampFormat = "dd.MM.yyyy HH.mm.ss"; // norsk format
            this.log('timestampFormat satt til default => ', this.timestampFormat);
            this.homey.settings.set('timestampFormat', this.timestampFormat);
        }
        else {
            // migrere
            let s = '' + this.timestampFormat;
            if (s.includes('DD') || s.includes('YYYY')) {
                this.timestampFormat = s.replace('DD', 'dd');
                s = '' + this.timestampFormat;
                this.timestampFormat = s.replace('YYYY', 'yyyy');
                this.log("timestampFormat migrated to : '" + this.timestampFormat + "'");
            }
            else {
                this.log("timestampFormat did not need migration");
            }
        }
        this.debug = this.homey.settings.get('debug');
        this.log('debug: ', this.debug);
        this._debugInvocation = (this.debug === "invocation");
        this.timeZone = this.homey.clock.getTimezone();
        this.spreadsheetId = this.homey.settings.get('sheetId');
        this.log("spreadsheetId(sheetId): '" + this.spreadsheetId + "'");
        let xx_spreadsheetId = this.homey.settings.get('spreadsheetId'); // if accidentally spaces are around
        this.log("spreadsheetId(as spreadsheetId): '" + xx_spreadsheetId + "'");
        this.delimiter = this.homey.settings.get('delimiter');
        this.log('delimiter: ', this.delimiter);
        if (this.delimiter === null) {
            this.delimiter = "|";
            this.log('delimiter satt til default => ', this.delimiter);
        }
        let fireAndForgetString = this.homey.settings.get('fireAndForget');
        if (fireAndForgetString !== null && fireAndForgetString === "true") {
            this.fireAndForget = true;
            this.log('fireAndForget = true');
        }
        else {
            this.fireAndForget = false;
        }
        let retryOn404String = this.homey.settings.get('retryOn404');
        if (retryOn404String !== null && retryOn404String === "true") {
            this.retryOn404 = true;
        }
        else {
            this.retryOn404 = false;
        }
        this.log('retryOn404 =', this.retryOn404);
        let intervalCapString = this.homey.settings.get('intervalCap');
        if (intervalCapString !== null) {
            this.log('intervalCapString was ' + intervalCapString);
            const parsed = parseInt(intervalCapString, 10);
            if (isNaN(parsed)) {
                this.log('intervalCap was invalid: ' + intervalCapString + ", using default value of 59");
                this.intervalCap = 59;
            }
            else {
                this.intervalCap = parsed;
            }
        }
        this.log('intervalCap = ' + this.intervalCap);
        var credentials = this.homey.settings.get('credentials');
        //this.log('credentials: ', credentials);
        if (this.spreadsheetId === null) {
            this.log('spreadsheetId ikke oppgitt, avslutter');
            return;
        }
        if (credentials === null) {
            this.log('credentials ikke oppgitt, avslutter');
            return;
        }
        var privatekey;
        try {
            privatekey = JSON.parse(credentials);
            // if('true' === this.debug) {
            //   this.log(" > credentials json file content follows....");
            //   this.log(" > type", privatekey.type);
            //   this.log(" > project_id", privatekey.project_id);
            //   this.log(" > private_key_id", privatekey.private_key_id);
            //   this.log(" > private_key (50 first chars)\n", privatekey.private_key.substring(0,50));
            //   this.log(" > client_email", privatekey.client_email);
            //   this.log(" > client_id", privatekey.client_id);
            //   this.log(" > auth_uri", privatekey.auth_uri);
            //   this.log(" > token_uri", privatekey.token_uri);
            //   this.log(" > auth_provider_x509_cert_url", privatekey.auth_provider_x509_cert_url);
            //   this.log(" > client_x509_cert_url", privatekey.client_x509_cert_url);
            // }
        }
        catch (err) {
            this.error("Credentials file were invalid, could not parse the content", err);
            return;
        }
        /*
          https://www.npmjs.com/package/google-auth-library
          
          Handling token events
          This library will automatically obtain an access_token, and automatically refresh the access_token if a refresh_token is present.
          The refresh_token is only returned on the first authorization, so if you want to make sure you store it safely.
          An easy way to make sure you always store the most recent tokens is to use the tokens event:
        */
        this.jwtClient = new google_auth_library_1.JWT(privatekey.client_email, undefined, privatekey.private_key, ['https://www.googleapis.com/auth/spreadsheets']);
        const api = new EasyLoggerApi_1.EasyLoggerApi({
            homey: this.homey,
            logger: this.log,
            errorlogger: this.error,
            delimiter: this.delimiter,
            jwtClient: this.jwtClient,
            spreadsheetId: this.spreadsheetId,
            debug: this.debug,
            timestampFormat: '' + this.timestampFormat,
            timezone: this.timeZone,
            intervalCap: this.intervalCap,
            fireAndForget: this.fireAndForget,
            retryOn404: this.retryOn404
        });
        this.log("Trying to authenticate...");
        await this.jwtClient.authorize(function (err, tokens) {
            if (err) {
                api._errorlogger(err);
                return;
            }
            else {
                api._logger("Successfully connected to Google API !");
                //console.log("Successfully connected to Google API !");
            }
        });
        this.log('timeZone: ', this.timeZone);
        this.log('local time at start of this app', api.getCurrentTimestampString());
        this.homey.flow.getActionCard('empty-queue').registerRunListener(async () => {
            if (this._debugInvocation)
                this.log(">>> empty-queue");
            await api.doEmptyQueue();
        });
        this.homey.flow.getActionCard('create-sheet').registerRunListener(async (value) => {
            if (this._debugInvocation)
                this.log(">>> create-sheet: ", value['sheet-name']);
            try {
                if (this.fireAndForget)
                    api.doAddSheet(value);
                else
                    await api.doAddSheet(value);
            }
            catch (error) {
                api._errorlogger("Error occured for create-sheet with ", value);
                api._errorlogger(error);
                throw error;
            }
        });
        this.homey.flow.getActionCard('set-cell-delimited-data').registerRunListener(async (value) => {
            if (this._debugInvocation)
                this.log(">>> set-cell-delimited-data: ", value['delimited-data']);
            try {
                if (this.fireAndForget)
                    api.doSetCellValue(value);
                else
                    await api.doSetCellValue(value);
            }
            catch (error) {
                api._errorlogger("Error occured for set-cell-delimited-data with ", value);
                api._errorlogger(error);
                throw error;
            }
        });
        this.homey.flow.getActionCard('append-multicell-delimited-value').registerRunListener(async (value) => {
            if (this._debugInvocation)
                this.log(">>> append-multicell-delimited-value: ", value['delimited-data']);
            try {
                if (this.fireAndForget)
                    api.doAppendMultiCelldelimitedValue(value);
                else
                    await api.doAppendMultiCelldelimitedValue(value);
            }
            catch (error) {
                api._errorlogger("Error occured for append-multicell-delimited-value with ", value);
                api._errorlogger(error);
                throw error;
            }
        });
        this.homey.flow.getActionCard('insert-multicell-delimited-value').registerRunListener(async (value) => {
            if (this._debugInvocation)
                this.log(">>> insert-multicell-delimited-value: ", value['delimited-data']);
            try {
                if (this.fireAndForget)
                    api.doInsertMultiCelldelimitedValue(value);
                else
                    await api.doInsertMultiCelldelimitedValue(value);
            }
            catch (error) {
                api._errorlogger("Error occured for insert-multicell-delimited-value with ", value);
                api._errorlogger(error);
                throw error;
            }
        });
        this.homey.flow.getActionCard('update-multicell-delimited-value').registerRunListener(async (value) => {
            if (this._debugInvocation)
                this.log(">>> update-multicell-delimited-value: ", value['delimited-data']);
            try {
                if (this.fireAndForget)
                    api.doUpdateMultiCelldelimitedValue(value);
                else
                    await api.doUpdateMultiCelldelimitedValue(value);
            }
            catch (error) {
                api._errorlogger("Error occured for update-multicell-delimited-value with ", value);
                api._errorlogger(error);
                throw error;
            }
        });
        //this.addFetchTimeout(1);
    } // end onInit
} // end-class
module.exports = EasyLoggerApp;
