'use strict';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';
import { getAuthToken, callHTTP, multiPartUploadSDK, deployToBigIp, multiPartUploadILX } from './coreF5HTTPS';
import * as utils from './utils';
import * as path from 'path';
import * as fs from 'fs';

/*
most of these functions are extracted from f5-fast-core cli
https://github.com/f5devcentral/f5-fast-core/blob/develop/cli.js
*/

// const path = require('path');
// import { displayWebView } from './fastHtmlPreveiwWebview';

const fast = require('@f5devcentral/f5-fast-core');


/**
 * single fast template validate, zip, upload and import function
 * will detect what device is currently selected
 * @param doc template/text from editor (or selection)
 */
export async function zipPost (doc: string) {

    /*
    look at using a system temp directory also fs.mkdtemp(dirprefix)
    https://nodejs.org/api/fs.html#fs_fs_mkdtemp_prefix_options_callback
    https://code.visualstudio.com/api/references/vscode-api#ExtensionContext
    */

    //get folder name from user
    //  potentially make this an input/select box to allow create a new folder or select existing
    const fastTemplateFolderName = await vscode.window.showInputBox({
        prompt: 'Destination FAST Templates Folder Name ---',
        value: 'default'
    });

    // get template name from user
    const fastTemplateName = await vscode.window.showInputBox({
        placeHolder: 'appTemplate1',
        value: 'testTemplate',
        prompt: 'Input Destination FAST Template Name ---'
    });

    if (!fastTemplateName) {
        // if no destination template name provided, it will fail, so exit
        return vscode.window.showWarningMessage('No destination FAST template name provided!');
    }
    
    
    // const coreDir = ext.context.globalStoragePath;
    // --- set extension context directory, ie-windows10: c:\Users\TestUser\vscode-f5-fast\
    const coreDir = ext.context.extensionPath; 
    // const tmpDir = fastTemplateFolderName;
    const fullTempDir = path.join(coreDir, 'fastTemplateFolderUploadTemp');
    const zipOut = path.join(coreDir, `${fastTemplateFolderName}.zip`);
    // const zipOut = path.join(coreDir, 'dummy.txt');
    
    console.log('fast Template Folder Name: ', fastTemplateFolderName);
    console.log('fast Template Name: ', fastTemplateName);
    console.log('base directory: ', coreDir);
    console.log('full Temp directory: ', fullTempDir);
    console.log('zip output dir/fileName: ', zipOut);


    // console.log(fullTempDir);
    // // log whats in the current coreDir-ext storagePath
    // console.log(fs.readdirSync(coreDir));
    
    // debugger;
    //  if the temp directory is not there, create it
    //      this shouldn't happen but if things get stuck half way...
    if (!fs.existsSync(fullTempDir)) {
        fs.mkdirSync(fullTempDir);
    }

    // // log whats in the new folder in above dir
    // console.log(fs.readdirSync(fullTempDir));

    fs.writeFileSync(path.join(fullTempDir, `${fastTemplateName}.mst`), doc);
    // fs.writeFileSync(path.join(coreDir, 'testFile.txt'), 'testttties!!!');
    
    // debugger;
    // const tempZip = packageTemplateSet(fullTempDir);
    const zipedTemplates = await packageTemplateSet2(fullTempDir, zipOut);
    // console.log(package1);
    // console.log('zipOut', zipOut);


    /**
     * if we have gotten this far, it's time to get ready for POST
     */

    const device = ext.hostStatusBar.text;
    const password = await utils.getPassword(device);
    const [username, host] = device.split('@');
    const authToken = await getAuthToken(host, username, password);

    //f5-sdk-js version
    const uploadStatus = await multiPartUploadSDK(zipOut, host, authToken);
    console.log('sdk upload response', uploadStatus);
    
    // icontrollx-dev-kit version
    // const deploy = await deployToBigIp({host, user: username, password}, zipOut);
    // console.log('ilx upload response', deploy);


    // debugger;
    const importStatus = await callHTTP('POST', host, '/mgmt/shared/fast/templatesets', authToken,
        {
            name: fastTemplateFolderName
        });
    console.log('template import status: ', importStatus);
    

    console.log(`Pending Delete`);
    // if the temp directory is there, list contents, delete all files, then delete the directory
    if (fs.existsSync(fullTempDir)) {
        const dirContents = fs.readdirSync(fullTempDir);
        // debugger;
        dirContents.map( item => {
            const pathFile = path.join(fullTempDir, item);
            console.log(`Deleting file: ${pathFile}`);
            fs.unlinkSync(pathFile);
        });
        
        console.log(`Deleting folder: ${fullTempDir}`);
        fs.rmdirSync(fullTempDir, { recursive: true });
    }
}


// https://github.com/zinkem/fast-docker/blob/master/templates/index.yaml

/**
 * Second try - WORKING!!!!
 * package templateSet function from f5-fast-core cli
 * @param tsPath path to folder containing ONLY fast templates
 * @param dst output path/file.zip
 */
async function packageTemplateSet2(tsPath: string, dst?: string) {
    console.log('packagingTemplateSet, path: ', tsPath, 'destination: ', dst);
    
    await validateTemplateSet(tsPath)
    .then(async () => {
        const tsName = path.basename(tsPath);
        const tsDir = path.dirname(tsPath);
        const provider = new fast.FsTemplateProvider(tsDir, [tsName]);
        console.log('provider object below \\/\\/', provider);

        dst = dst || `./${tsName}.zip`;
        console.log('dest file name', dst);
        
        await provider.buildPackage(tsName, dst)
            .then(() => {
                console.log(`tspath ${tsPath}`);
                console.log(`Template set "${tsName}" packaged as ${dst}`);
                return dst;
            })
            .catch((error: any) => {
                console.log(error);
            });
    });

}


/**
 * f5-fast-core load template function
 * https://github.com/f5devcentral/f5-fast-core/blob/develop/cli.js
 * @param templatePath 
 */
async function loadTemplate(templatePath: string) {
    const tmplName = path.basename(templatePath, path.extname(templatePath));
    const tsName = path.basename(path.dirname(templatePath));
    const tsDir = path.dirname(path.dirname(templatePath));
    const provider = new fast.FsTemplateProvider(tsDir, [tsName]);
    return provider.fetch(`${tsName}/${tmplName}`)
        .catch((e: { stack: any; }) => {
            const validationErrors = fast.Template.getValidationErrors();
            if (validationErrors !== 'null') {
                console.error(validationErrors);
            }
            console.error(`failed to load template\n${e.stack}`);
            process.exit(1);
        });
};

const validateTemplate = (templatePath: string) => loadTemplate(templatePath)
    .then(() => {
        console.log(`template source at ${templatePath} is valid`);
    });


/**
 * f5-fast-core validate template set function
 * https://github.com/f5devcentral/f5-fast-core/blob/develop/cli.js
 * @param tsPath 
 */
async function validateTemplateSet (tsPath: string) {
    const tsName = path.basename(tsPath);
    const tsDir = path.dirname(tsPath);
    const provider = new fast.FsTemplateProvider(tsDir, [tsName]);
    console.log('validating template set!!!');
    
    return provider.list()
        .then((templateList: any) => Promise.all(templateList.map((tmpl: any) => provider.fetch(tmpl))))
        .catch((e: { stack: any; }) => {
            console.error(`Template set "${tsName}" failed validation:\n${e.stack}`);
            // process.exit(1);
        });
};


// /**
//  *  NOT WORKING
//  * f5-fast-core package template set function 
//  * @param tsPath 
//  * @param dst 
//  */
// function packageTemplateSet(tsPath: string, dst?: string) {
//     console.log('packagingTemplateSet, path: ', tsPath, dst);
    
//     // validateTemplateSet(tsPath)
//     // .then(() => {
//     //     const tsName = path.basename(tsPath);
//     //     const tsDir = path.dirname(tsPath);
//     //     const provider = new fast.FsTemplateProvider(tsDir, [tsName]);
//     //     console.log('provider', provider);

//     //     dst = dst || `./${tsName}.zip`;
//     //     console.log('dest file name', dst);
        

//     //     return provider.buildPackage(tsName, dst)
//     //         .then(() => {
//     //             console.log(`Template set "${tsName}" packaged as ${dst}`);
//     //         });
//     // });
// };
