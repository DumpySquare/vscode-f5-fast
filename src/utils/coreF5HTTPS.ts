
'use strict';
import * as vscode from 'vscode';
import { request } from 'https';
var https = require('https');
import * as fs from 'fs';
import { ext } from '../extensionVariables';
import * as path from 'path';
// import https from 'https';
import axios, { AxiosBasicCredentials } from 'axios';


// const { Writable } = require('stream');
// const { EventEmitter } = require('events');

/**
 * Get tmos auth token
 * @param host fqdn or IP address of destination
 * @param username 
 * @param password 
 */
export const getAuthToken = async (host: string, username: string, password: string) => makeRequest(
    {
        host,
        path: '/mgmt/shared/authn/login',
        method: 'POST',
    }, 
    { 
        username,
        password,
        logonProviderName: ext.logonProviderName
    })
    .then( async res => {
        if (res.status === 200) {
            return res.body.token.token;
        } else if (res.status === 401 && res.body.message === "Authentication failed.") {
            // clear cached password for this device
            ext.keyTar.deletePassword('f5Hosts', `${username}@${host}`);
    
            vscode.window.showErrorMessage(`HTTP FAILURE: ${res.status} - ${res.body.message}`);
            console.error(`HTTP FAILURE: ${res.status} - ${res.body.message}`);
            throw new Error(`HTTP FAILURE: ${res.status} - ${res.body.message}`);
        } else {
            // await new Promise(resolve => { setTimeout(resolve, 3000); });
            vscode.window.showErrorMessage(`HTTP FAILURE: ${res.status} - ${res.body.message}`);
            console.error(`HTTP FAILURE: ${res.status} - ${res.body.message}`);
            throw new Error(`HTTP FAILURE: ${res.status} - ${res.body.message}`);
        }
});


/**
 * core makeRequest wrapper for f5 https calls
 * @param method HTTP method (GET,POST)
 * @param host hostname/ip of destination
 * @param path uri path
 * @param token bigip auth token value
 * @param payload json object post payload
 */
export const callHTTP = (method: string, host: string, path: string, token: string, payload: object = {}) => makeRequest(
    {
        method,
        host,
        path,
        headers: {
            'Content-Type': 'application/json',
            'X-F5-Auth-Token': token
        }
    },
    payload
)
.then( response => {
    return response;
});



/**
 * multi part upload from f5-sdk-js - testing - work in progress
 * modified from:
 * https://github.com/f5devcentral/f5-sdk-js/blob/master/src/bigip/extension/package.ts
 * @param file ?
 * @param host 
 * @param token aut token
 */

export async function multiPartUploadSDK(file: string, host: string, token: string) {

    console.log('MULTI-PART-UPLOAD-SDK', file, host, token);

    // TODO:  move the following filename extraction back up one level to f5FastUtils
    //      and pass in as parameter?
    // const fileName = file.split('/')[file.split('/').length - 1];
    const fileName2 = path.parse(file).base;
    // const fileNameS = 'fastTempUpload.zip';
    
    const fileStats = fs.statSync(file);
    const chunkSize = 1024 * 1024;
    let start = 0;
    let end = Math.min(chunkSize, fileStats.size-1);
    let uploadStat;
    while (end <= fileStats.size - 1 && start < end) {

        uploadStat = await makeRequestAX( host, `/mgmt/shared/file-transfer/uploads/${fileName2}`, 
            {
                method: 'POST',
                headers: {
                    'X-F5-Auth-Token': token,
                    'Content-Type': 'application/octet-stream',
                    'Content-Range': `${start}-${end}/${fileStats.size}`,
                    'Content-Length': end - start + 1
                },
                body: fs.createReadStream(file, { start, end }),
                // contentType: 'raw'
            }
        );

        start += chunkSize;
        if (end + chunkSize < fileStats.size - 1) { // more to go
            end += chunkSize;
        } else if (end + chunkSize > fileStats.size - 1) { // last chunk
            end = fileStats.size - 1;
        } else { // done - could use do..while loop instead of this
            end = fileStats.size;
        }
        // console.log('upload stat in loop', uploadStat);
        
    }
    // console.log('upload stat done', uploadStat);
    return uploadStat;
};


/**
 * Axios HTTPS agent 
 * modeled after f5-sdk-js implementation
 * Will probably become the new https method, but will need some refactoring
 * @param host hostname/IP
 * @param uri http uri path
 * @param options http options (method, port, body, headers, basicAuth)
 */
async function makeRequestAX(host: string, uri: string, options: {
    method?: any; 
    port?: number;
    body?: object;
    headers?: object;
    // auth?: object;
    // basicAuth?: object;
    // advancedReturn?: boolean;
}): Promise<object> {
    options = options || {};

    // logger.debug(`Making HTTP request: ${host} ${uri} ${JSON.stringify(options)}`);
    console.log(`Making HTTP request: ${host} ${uri} ${JSON.stringify(options)}`);

    const httpResponse = await axios.request({
        httpsAgent: new https.Agent({
            rejectUnauthorized: false
        }),
        method: options['method'] || 'GET',
        baseURL: `https://${host}:${options['port'] || 443}`,
        url: uri,
        headers: options['headers'] !== undefined ? options['headers'] : {},
        data: options['body'] || null,
        // auth: options['basicAuth'] !== undefined ? {
        //     username: options['basicAuth']['user'],
        //     password: options['basicAuth']['password']
        // } : undefined,
        // validateStatus: null
    });

    // // check for advanced return
    // if (options.advancedReturn) {
    //     return {
    //         statusCode: httpResponse.status,
    //         body: httpResponse.data
    //     };
    // }

    // check for unsuccessful request
    if (httpResponse.status > 300) {
        return Promise.reject(new Error(
            `HTTP request failed: ${httpResponse.status} ${JSON.stringify(httpResponse.data)}`
        ));
    }
    // return response body
    return httpResponse;
}




interface OptsObject {
    host: string,
    port?: number,
    path: string,
    method?: string,
    headers?: object,
}

/**
 * Core HTTPs request
 * @param opts https call options
 * @param payload http call payload
 */
function makeRequest(opts: OptsObject, payload?: object ): Promise<any> {

    const defaultOpts = {
        port: 443,
        method: 'GET',
        rejectUnauthorized: false,
        headers: {
            'Content-Type': 'application/json'
        }
    };

    if(opts.host.includes(':')) {
        var [host, port] = opts.host.split(':');
        opts.host = host;
        opts.port = parseInt(port);
    }

    // combine defaults with passed in options
    const combOpts = Object.assign({}, defaultOpts, opts);

    console.log(`HTTP-REQUEST: ${combOpts.host} - ${combOpts.method} - ${combOpts.path}`, combOpts);
    // exclude logging of user creds for auth token and empty body, but log everything else
    if(combOpts.path !== '/mgmt/shared/authn/login' && combOpts.method === 'POST') {
        console.log(`HTTP-REQUEST-BODY`, payload);
    }

    return new Promise((resolve, reject) => {
        const req = request(combOpts, (res) => {
            const buffer: any = [];
            res.setEncoding('utf8');
            res.on('data', (data) => {
                buffer.push(data);
            });
            res.on('end', () => {
                let body = buffer.join('');
                body = body || '{}';

                try {
                    body = JSON.parse(body);
                } catch (e) {
                    console.log(combOpts);
                    console.log(e);
                    return reject(new Error(`Invalid response object ${combOpts}`));
                };
                
                // // TODO: configure global logging system
                // console.log('makeRequest***STATUS: ' + res.statusCode);
                // console.log('makeRequest***HEADERS: ' + JSON.stringify(res.headers));
                // console.log('makeRequest***BODY: ' + JSON.stringify(body));

                console.log(`HTTP-RESPONSE: ${res.statusCode}`);
                console.log({
                    status: res.statusCode,
                    headers: res.headers,
                    body
                });

                
                const goodResp: Array<number> = [200, 201, 202];
                // was trying to check against array above with arr.includes or arr.indexOf
                /**
                 * Opening this up to any response code, to handle errors higher in logic
                 * might need to key off 500s and more 400s when waitng for DO
                 */
                // if (res.statusCode === 200 || res.statusCode === 201 || res.statusCode === 202 || res.statusCode === 404 || res.statusCode === 422) {
                    if (res.statusCode) {
                    return resolve({
                        status: res.statusCode,
                        headers: res.headers,
                        body
                    });
                } else {
                    vscode.window.showErrorMessage(`HTTP FAILURE: ${res.statusCode} - ${res.statusMessage}`);
                    console.error(`HTTP FAILURE: ${res.statusCode} - ${res.statusMessage}`);
                    return reject(new Error(`HTTP - ${res.statusCode} - ${res.statusMessage}`));
                }

            });
        });

        req.on('error', (e) => {
            // might need to stringify combOpts for proper log output
            reject(new Error(`${combOpts}:${e.message}`));
        });

        // if a payload was passed in, post it!
        if (payload) {
            req.write(JSON.stringify(payload));
        }
        req.end();
    });
};


