'use strict';

import * as vscode from 'vscode';
import { makeAuth, makeReqAXnew, multiPartUploadSDK } from './coreF5HTTPS';
import { ext } from '../extensionVariables';
import * as utils from './utils';

/**
 *
 * Basic Example:
 * 
 * ```
 * const mgmtClient = new ManagementClient({
 *      host: '192.0.2.1',
 *      port: 443,
 *      user: 'admin',
 *      password: 'admin'
 * });
 * await mgmtClient.getToken();
 * const variable = await mgmtClient.makeRequest('/mgmt/tm/sys/version');
 * ```
 */
export class MgmtClient {
    device: string;
    host: string;
    port: number | 443;
    provider: string;
    protected _user: string;
    protected _password: string;
    protected _token!: string | '1234';
    protected _tokn: any;
    protected _tmrBar: any;
    protected _timeout: any;

    // set above token to '1234' to get through TS typing
    // at instaniation it will be empty but should get updated
    // via code as calls are made

    /**
     * @param options function options
     */
    constructor(
        device: string,
        options: {
        host: string;
        port: number;
        user: string;
        provider: string;
        password: string;
    }) {
        this.device = device;
        this.host = options['host'];
        this.port = options['port'] || 443;
        this.provider = options['provider'];
        this._user = options['user'];
        this._password = options['password'];
    }


    /**
     * Login (using credentials provided during instantiation)
     * sets/gets/refreshes auth token
     * @returns void
     */
    private async getToken(): Promise<void> {

        console.log('reFreshing auth token', `${this.host}:${this.port}`);

        // if(!this._tokn){
        //     console.log('no token detected - fetching fresh token');
        // } else {
        //     console.log('--token detected - issue time: ', this._tokn.startTime);
        //     console.log('tokn timeout', this._tokn.timeout);
        // }

        // const d = new Date();
        // console.log('current system iso time', d.toISOString());

        const resp: any = await makeAuth(`${this.host}:${this.port}`, {
            username: this._user,
            password: this._password,
            loginProviderName: this.provider
        });

        if(resp.status === 200){
            // assign token and exit sucessfully
            this._token = resp.data['token']['token'];
            this._tokn = resp.data.token;
            this._timeout = this._tokn.timeout;

            console.log('newToken', this._token);
            console.log('newTokn', this._tokn);

            this.tokenTimer();  // start token timer


            // this._timer.setTimer(this._tokn.timeout);
            // this._timer.start();
            // this._timer.onTimeChanged( el => { this._tmrBar.text = el.remainingSeconds;});
            return;

        } else {
            const status = resp.status;
            const message = resp.data.message;

            // if user/pass failed - clear cached password
            if(message === "Authentication failed.") {
                console.error('401 - auth failed!!!!!!  +++ clearning cached password +++');
                vscode.window.showErrorMessage('Authentication Failed - clearing password');
                // clear cached password
                ext.keyTar.deletePassword('f5Hosts', `${this._user}@${this.host}`);
            } 

            vscode.window.showErrorMessage(`HTTP Auth FAILURE: ${status} - ${message}`);
            console.error(`HTTP Auth FAILURE: ${status} - ${message} - ${JSON.stringify(resp.data)}`);
            throw new Error(`HTTP Auth FAILURE: ${status} - ${message}`);
        }

    }

    /**
     * connect to f5 and discover ATC services
     * Pulls device/connection details from this. within the class
     */
    async connect() {
        const progress = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Connecting to ${this.host}`,
            cancellable: true
        }, async (progress, token) => {
            token.onCancellationRequested(() => {
                // this logs but doesn't actually cancel...
                console.log("User canceled device connect");
                return new Error(`User canceled device connect`);
            });
            
            
            await this.getToken();
            
            let returnInfo: string[] = [];
 

            // cache password in keytar
            ext.keyTar.setPassword('f5Hosts', this.device, this._password);

            utils.setHostStatusBar(this.device);    // show device bar
            ext.connectBar.hide();      // hide connect bar
            
            //********** Host info **********/
            const hostInfo: any = await this.makeRequest('/mgmt/shared/identified-devices/config/device-info');
            if (hostInfo.status === 200) {
                const text = `${hostInfo.data.hostname}`;
                const tip = `TMOS: ${hostInfo.data.version}`;
                utils.setHostnameBar(text, tip);
                returnInfo.push(text);
            }

            progress.report({ message: `CONNECTED, checking installed ATC services...`});


            //********** FAST info **********/
            const fastInfo: any = await this.makeRequest('/mgmt/shared/fast/info');
            if (fastInfo.status === 200) {
                const text = `FAST(${fastInfo.data.version})`;
                utils.setFastBar(text);
                returnInfo.push(text);
            }

            //********** AS3 info **********/
            const as3Info: any = await this.makeRequest('/mgmt/shared/appsvcs/info');

            if (as3Info.status === 200) {
                const text = `AS3(${as3Info.data.version})`;
                const tip = `CLICK FOR ALL TENANTS \r\nschemaCurrent: ${as3Info.data.schemaCurrent} `;
                utils.setAS3Bar(text, tip);
                returnInfo.push(text);
            }
            
            //********** DO info **********/
            const doInfo: any = await this.makeRequest('/mgmt/shared/declarative-onboarding/info');

            if (doInfo.status === 200) {
                // for some reason DO responds with a list for version info...
                const text = `DO(${doInfo.data[0].version})`;
                const tip = `schemaCurrent: ${doInfo.data[0].schemaCurrent} `;
                utils.setDOBar(text, tip);
                returnInfo.push(text);
            }

            //********** TS info **********/
            const tsInfo: any = await this.makeRequest('/mgmt/shared/telemetry/info');
            if (tsInfo.status === 200) {
                const text = `TS(${tsInfo.data.version})`;
                const tip = `nodeVersion: ${tsInfo.data.nodeVersion}\r\nschemaCurrent: ${tsInfo.data.schemaCurrent} `;
                utils.setTSBar(text, tip);
                returnInfo.push(text);
            }
            return returnInfo;
        });
        return progress;
    }

    /**
     * setup multi part upload to f5 function
     * @param file full path/file location
     */
    async upload(file: string) {
        return await multiPartUploadSDK(file, this.host, this.port, this._token);
    }





    /**
     * Make HTTP request
     * - utilizes device details/user/pass/token
     * set within the class
     * 
     * @param uri     request URI
     * @param options function options
     * 
     * @returns request response
     */
    async makeRequest(uri: string, options?: {
        method?: string;
        headers?: object;
        body?: object;
        contentType?: string;
        advancedReturn?: boolean;
    }): Promise<object>  {
        options = options || {};

        // if authe token has expired, get new one
        if(!this._tokn){
            await this.getToken();
        }

        return await makeReqAXnew(
            this.host,
            uri,
            {
                method: options.method || 'GET',
                port: this.port,
                headers: Object.assign(options.headers || {}, {
                    'X-F5-Auth-Token': this._token,
                    'Content-Type': 'application/json'
                }),
                body: options.body || undefined,
                advancedReturn: options.advancedReturn || false
            }
        );
    }

    private async tokenTimer() {
        // this._timeout = 60;
        // let timeout = this._tokn.timeout;
        this._tmrBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        this._tmrBar.tooltip = 'F5 AuthToken Timer';
        this._tmrBar.color = 'silver';
        this._tmrBar.show();

        let intervalId = setInterval(() => {
            this._tmrBar.text = `${this._timeout}`;
            // console.log('token timeout', timeout);
            this._timeout--;
            if (this._timeout <= 0) {
                clearInterval(intervalId);
                this._tmrBar.hide();
                console.log('authToken expired');
                this._tokn = undefined; // clearing token details should get a new token
                this._tmrBar.dispose();
            } else if (this._timeout <= 30){
                this._tmrBar.color = '#ED5A75';
            }
        }, 1000);
        
    }
    async disconnect() {

        this._timeout = 0;  // zero/expire authToken

        utils.setHostStatusBar();
		utils.setHostnameBar();
		utils.setFastBar();
		utils.setAS3Bar();
		utils.setDOBar();
		utils.setTSBar();

		ext.connectBar.show();
    }

}

