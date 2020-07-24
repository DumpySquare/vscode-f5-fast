'use strict';

import * as vscode from 'vscode';
import * as jsYaml from 'js-yaml';
import * as path from 'path';
import * as fs from 'fs';
import * as keyTarType from 'keytar';

import { F5TreeProvider } from './treeViewsProviders/hostsTreeProvider';
import { AS3TreeProvider } from './treeViewsProviders/as3TasksTreeProvider';
import { AS3TenantTreeProvider } from './treeViewsProviders/as3TenantTreeProvider';
import { ExampleDecsProvider } from './treeViewsProviders/githubDecExamples';
import { FastTemplatesTreeProvider } from './treeViewsProviders/fastTreeProvider';
import * as f5Api from './utils/f5Api';
import { callHTTPS } from './utils/externalAPIs';
import * as utils from './utils/utils';
import { ext, git } from './extensionVariables';
import { displayWebView, WebViewPanel } from './webview';
import { FastWebViewPanel } from './utils/fastHtmlPreveiwWebview';
import * as f5FastApi from './utils/f5FastApi';
import * as f5FastUtils from './utils/f5FastUtils';
import * as rpmMgmt from './utils/rpmMgmt';
import { MgmtClient } from './utils/f5DeviceClient';
import { chuckJoke1 } from './chuckJoke';

const fast = require('@f5devcentral/f5-fast-core');

// import { MemFS } from './treeViewsProviders/fileSystemProvider';
// import { HttpResponseWebview } from './responseWebview';

export function activate(context: vscode.ExtensionContext) {

	console.log('Congratulations, your extension "vscode-f5-fast" is now active!');

	// assign context to global
	ext.context = context;

	// Create a status bar item
	ext.hostStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 15);
	context.subscriptions.push(ext.hostStatusBar);
	ext.hostNameBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 14);
	context.subscriptions.push(ext.hostNameBar);
	ext.fastBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 13);
	context.subscriptions.push(ext.fastBar);
	ext.as3Bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 12);
	context.subscriptions.push(ext.as3Bar);
	ext.doBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 11);
	context.subscriptions.push(ext.doBar);
	ext.tsBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
	context.subscriptions.push(ext.tsBar);
	

	ext.connectBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 9);
	context.subscriptions.push(ext.connectBar);
	ext.connectBar.command = 'f5.connectDevice';
    ext.connectBar.text = 'F5-FAST -> Connect!';
	ext.connectBar.tooltip = 'Click to connect!';
	ext.connectBar.show();
	

	ext.keyTar = keyTarType;

	// keep an eye on this for different user install scenarios, like slim docker containers that don't have the supporting librarys
	// if this error happens, need to find a fallback method of password caching or disable caching without breaking everything
	if (ext.keyTar === undefined) {
		throw new Error('keytar undefined in initiation');
	}



	/**
	 * #########################################################################
	 *
	 * 	     ########  ######## ##     ## ####  ######  ########  ######  
	 *	     ##     ## ##       ##     ##  ##  ##    ## ##       ##    ## 
	 *	     ##     ## ##       ##     ##  ##  ##       ##       ##       
	 *	     ##     ## ######   ##     ##  ##  ##       ######    ######  
	 *	     ##     ## ##        ##   ##   ##  ##       ##             ## 
	 *	     ##     ## ##         ## ##    ##  ##    ## ##       ##    ## 
	 * 	     ########  ########    ###    ####  ######  ########  ######  
	 * 
	 * http://patorjk.com/software/taag/#p=display&h=0&f=Banner3&t=Devices
	 * #########################################################################
	 */
	

	const hostsTreeProvider = new F5TreeProvider('');
	vscode.window.registerTreeDataProvider('f5Hosts', hostsTreeProvider);
	vscode.commands.registerCommand('f5.refreshHostsTree', () => hostsTreeProvider.refresh());
	
	context.subscriptions.push(vscode.commands.registerCommand('f5.connectDevice', async (device) => {
		

		console.log('selected device', device);

		// clear status bars before new connect
		utils.setHostStatusBar();
		utils.setHostnameBar();
		utils.setFastBar();
		utils.setAS3Bar();
		utils.setDOBar();
		utils.setTSBar();	

		type devObj = {
			device: string,
			provider: string
		};
		
		if (!device) {
			const bigipHosts: Array<devObj> | undefined = await vscode.workspace.getConfiguration().get('f5.hosts');

			if (bigipHosts === undefined) {
				throw new Error('no hosts in configuration');
			}

			/**
			 * loop through config array of objects and build quickPick list appropriate labels
			 * [ {label: admin@192.168.1.254:8443, target: { host: 192.168.1.254, user: admin, ...}}, ...]
			 */
			const qPickHostList = bigipHosts.map( item => {
				// let fullDevice = `${item.user}@${item.host}`;
				// if(item.hasOwnProperty('port')) {
				// 	fullDevice = `${fullDevice}:${item.port}`;
				// }
				return { label: item.device, target: item };
			});

			device = await vscode.window.showQuickPick(qPickHostList, {placeHolder: 'Select Device'});
			if (!device) {
				throw new Error('user exited device input');
			} else {
				// now that we made it through quickPick drop the label/object wrapper for list and just return device object
				device = device.target;
			}
		}
		
		console.log('device-connect', device);

		var [user, host] = device.device.split('@');
		var [host, port] = host.split(':');

		// ext.logonProviderName = device.provider;

		const password: string = await utils.getPassword(device.device);

		ext.mgmtClient = new MgmtClient( device.device, {
			host,
			port,
			user,
			provider: device.provider,
			password
		});

		// await ext.mgmtClient.getToken();
		const connect = await ext.mgmtClient.connect();
		console.log(`F5 Connect Discovered ${JSON.stringify(connect)}`);

		as3TenantTree.refresh();

	}));
	
	context.subscriptions.push(vscode.commands.registerCommand('f5.getProvider', async () => {

		await ext.mgmtClient.getToken();
		const resp: any = await ext.mgmtClient.makeRequest('/mgmt/tm/auth/source');

		utils.displayJsonInEditor(resp.data);
	}));


	context.subscriptions.push(vscode.commands.registerCommand('f5.getF5HostInfo', async () => {
		var device: string | undefined = ext.hostStatusBar.text;
		
		if (!device) {
			device = await vscode.commands.executeCommand('f5.connectDevice');
		}
		
		if (device === undefined) {
			throw new Error('no hosts in configuration');
		}

		await ext.mgmtClient.getToken();
		const resp: any = await ext.mgmtClient.makeRequest('/mgmt/shared/identified-devices/config/device-info');

		// const password: string = await utils.getPassword(device);
		// const hostInfo  = await f5Api.getF5HostInfo(device, password);

		utils.displayJsonInEditor(resp.data);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('f5.disconnect', () => {

		// clear status bars
		utils.setHostStatusBar();
		utils.setHostnameBar();
		utils.setFastBar();
		utils.setAS3Bar();
		utils.setDOBar();
		utils.setTSBar();

		ext.connectBar.show();

		// return vscode.window.showInformationMessage('clearing selected bigip and status bar details');
	}));

	context.subscriptions.push(vscode.commands.registerCommand('f5.clearPasswords', async () => {
		console.log('CLEARING KEYTAR PASSWORD CACHE');

		// clear status bars 
		utils.setHostStatusBar();
		utils.setHostnameBar();
		utils.setFastBar();
		utils.setAS3Bar();
		utils.setDOBar();
		utils.setTSBar();

		// get list of items in keytar for the 'f5Hosts' service
		await ext.keyTar.findCredentials('f5Hosts').then( list => {
			// map through and delete all
			list.map(item => ext.keyTar.deletePassword('f5Hosts', item.account));
		});

		return vscode.window.showInformationMessage('Disconnecting BIG-IP and clearing password cache');
	}));


	context.subscriptions.push(vscode.commands.registerCommand('f5.removeHost', async (hostID) => {
		console.log(`Remove Host command: ${JSON.stringify(hostID)}`);
		
		let bigipHosts: {device: string} [] | undefined = vscode.workspace.getConfiguration().get('f5.hosts');
		// console.log(`Current bigipHosts: ${JSON.stringify(bigipHosts)}`)
		
		if ( !bigipHosts || !hostID) {
			throw new Error('device delete, no devices in config or no selected host to delete');
		}
		const newBigipHosts = bigipHosts.filter( item => item.device !== hostID.label);
		// console.log(`less bigipHosts: ${JSON.stringify(newBigipHosts)}`)
		
		// vscode.window.showInformationMessage(`${JSON.stringify(hostID.label)} removed!!!`);
		await vscode.workspace.getConfiguration().update('f5.hosts', newBigipHosts, vscode.ConfigurationTarget.Global);
		hostsTreeProvider.refresh();
	}));
	
	context.subscriptions.push(vscode.commands.registerCommand('f5.editHost', async (hostID) => {
		
		console.log(`Edit Host command: ${JSON.stringify(hostID)}`);
		
		let bigipHosts: {device: string} [] | undefined= vscode.workspace.getConfiguration().get('f5.hosts');
		console.log(`Current bigipHosts: ${JSON.stringify(bigipHosts)}`);
		
		vscode.window.showInputBox({
			prompt: 'Update Device/BIG-IP/Host', 
			value: hostID.label
		})
		.then( input => {

			console.log('user input', input);

			if (input === undefined || bigipHosts === undefined) {
				throw new Error('Update device inputBox cancelled');
			}

			const deviceRex = /^[\w-.]+@[\w-.]+(:[0-9]+)?$/;
			const devicesString = JSON.stringify(bigipHosts);
			
			if (!devicesString.includes(`\"${input}\"`) && deviceRex.test(input)) {

				bigipHosts.forEach( (item: { device: string; }) => {
					if(item.device === hostID.label) {
						item.device = input;
					}
				});
				
				// vscode.window.showInformationMessage(`Updating ${input} device name.`);
				vscode.workspace.getConfiguration().update('f5.hosts', bigipHosts, vscode.ConfigurationTarget.Global);

				// need to give the configuration a chance to save before refresing tree
				setTimeout( () => { hostsTreeProvider.refresh();}, 300);
			} else {
		
				vscode.window.showErrorMessage('Already exists or invalid format: <user>@<host/ip>:<port>');
			}
		});
		
	}));



	context.subscriptions.push(vscode.commands.registerCommand('f5.editDeviceProvider', async (hostID) => {
		
		console.log(`EditDeviceProvider command: ${JSON.stringify(hostID)}`);
		
		let bigipHosts: {device: string} [] | undefined= vscode.workspace.getConfiguration().get('f5.hosts');
		console.log(`Current bigipHosts: ${JSON.stringify(bigipHosts)}`);
		
		vscode.window.showInputBox({
			prompt: 'Update Logon Provider', 
			value: hostID.version
		})
		.then( input => {

			console.log('user input', input);

			if (input === undefined || bigipHosts === undefined) {
				throw new Error('Update device inputBox cancelled');
			}

			bigipHosts.forEach( (item: { device: string; provider?: string; }) => {
				if(item.device === hostID.label) {
					item.provider = input;
				}
			});
			
			// vscode.window.showInformationMessage(`Updating ${hostID.label} device provider.`);
			vscode.workspace.getConfiguration().update('f5.hosts', bigipHosts, vscode.ConfigurationTarget.Global);

			setTimeout( () => { hostsTreeProvider.refresh();}, 300);
		});
		
	}));


	context.subscriptions.push(vscode.commands.registerCommand('f5.openSettings', () => {
		//	open settings window and bring the user to the F5 section
		return vscode.commands.executeCommand("workbench.action.openSettings", "f5");
	}));


	context.subscriptions.push(vscode.commands.registerCommand('f5.addHost', () => {

		vscode.window.showInputBox({prompt: 'Device/BIG-IP/Host', placeHolder: '<user>@<host/ip>'})
		.then(newHost => {
			let bigipHosts: {device: string} [] | undefined= vscode.workspace.getConfiguration().get('f5.hosts');

			if (newHost === undefined || bigipHosts === undefined) {
				throw new Error('Add device inputBox cancelled');
			}

			const deviceRex = /^[\w-.]+@[\w-.]+(:[0-9]+)?$/;		// matches any username combo an F5 will accept and host/ip
			const devicesString = JSON.stringify(bigipHosts);

			if (!devicesString.includes(`\"${newHost}\"`) && deviceRex.test(newHost)){
				bigipHosts.push({device: newHost});
				vscode.workspace.getConfiguration().update('f5.hosts', bigipHosts, vscode.ConfigurationTarget.Global);
				vscode.window.showInformationMessage(`Adding ${newHost} to list!`);
				hostsTreeProvider.refresh();
			} else {
				vscode.window.showErrorMessage('Already exists or invalid format: <user>@<host/ip>');
			}
		});

	}));


	//original way the example extension structured the command
	let disposable = vscode.commands.registerCommand('f5.remoteCommand', async () => {
	
		const cmd = await vscode.window.showInputBox({ placeHolder: 'Bash Command to Execute?' });
		
		if ( cmd === undefined ) {
			// maybe just showInformationMessage and exit instead of error?
			throw new Error('Remote Command inputBox cancelled');
		}

		await ext.mgmtClient.getToken();
		const resp: any = await ext.mgmtClient.makeRequest(`/mgmt/tm/util/bash`, {
			method: 'POST',
			body: {
				command: 'run',
				utilCmdArgs: `-c '${cmd}'`
			}
		});

		vscode.workspace.openTextDocument({ 
			language: 'text', 
			content: resp.data.commandResult
		})
		.then( doc => 
			vscode.window.showTextDocument(
				doc, 
				{ 
					preview: false 
				}
			)
		);
	});	
	context.subscriptions.push(disposable);



	context.subscriptions.push(vscode.commands.registerCommand('f5.installRPM', async (selectedRPM) => {


		if(selectedRPM) {
			// set rpm path/location from oject return in explorer tree
			selectedRPM = selectedRPM.fsPath;
			console.log(`workspace selected rpm`, selectedRPM);
		} else {
			// pick atc/tool/version picker/downloader
			selectedRPM = await rpmMgmt.rpmPicker();
			console.log('downloaded rpm location', selectedRPM);
		}

		// const iRpms = await rpmMgmt.installedRPMs();
		console.log('selected rpm', selectedRPM);
		// console.log('installed rpms', JSON.stringify(iRpms));

		if(!selectedRPM) {
			debugger;
			// probably need to setup error handling for this situation
		}
		
		const installedRpm = await rpmMgmt.rpmInstaller(selectedRPM);
		console.log('installed rpm', installedRpm);
		ext.mgmtClient.connect(); // refresh connect/status bars

	}));

	context.subscriptions.push(vscode.commands.registerCommand('f5.unInstallRPM', async (rpm) => {
		
		// if no rpm sent in from update command
		if(!rpm) {
			// get installed packages
			const installedRPMs = await rpmMgmt.installedRPMs();
			// have user select package
			rpm = await vscode.window.showQuickPick(installedRPMs, {placeHolder: 'select rpm to remove'});
		} else {
			// rpm came from rpm update call...
		}

		if(!rpm) {	// return error pop-up if quickPick escaped
			return vscode.window.showWarningMessage('user exited - did not select rpm to un-install');
		}

		const status = await rpmMgmt.unInstallRpm(rpm);
		vscode.window.showInformationMessage(`rpm ${rpm} removal ${status}`);
		// debugger;
		
		// used to pause between uninstalling and installing a new version of the same atc
		//		should probably put this somewhere else
		await new Promise(resolve => { setTimeout(resolve, 2000); });
		ext.mgmtClient.connect(); // refresh connect/status bars

	}));



	/**
	 * ###########################################################################
	 * 
	 *  			FFFFFFF   AAA    SSSSS  TTTTTTT 
 	 *  			FF       AAAAA  SS        TTT   
 	 *  			FFFF    AA   AA  SSSSS    TTT   
 	 *  			FF      AAAAAAA      SS   TTT   
 	 *  			FF      AA   AA  SSSSS    TTT   
	 * 
	 * ############################################################################
	 * http://patorjk.com/software/taag/#p=display&h=0&f=Letters&t=FAST
	 */
	
	// setting up hosts tree
	const fastTreeProvider = new FastTemplatesTreeProvider();
	vscode.window.registerTreeDataProvider('fastView', fastTreeProvider);
	vscode.commands.registerCommand('f5-fast.refreshTemplates', () => fastTreeProvider.refresh());

	context.subscriptions.push(vscode.commands.registerCommand('f5-fast.getInfo', async () => {

		await ext.mgmtClient.getToken();
		const resp: any = await ext.mgmtClient.makeRequest(`/mgmt/shared/fast/info`);

		if (ext.settings.previewResponseInUntitledDocument) {
			utils.displayJsonInEditor(resp.data);
		} else {
			WebViewPanel.render(context.extensionPath, resp.data);
		}

	}));

	context.subscriptions.push(vscode.commands.registerCommand('f5-fast.deployApp', async () => {

		// get editor window
		var editor = vscode.window.activeTextEditor;
		if (!editor) {	
			return; // No open text editor
		}

		// capture selected text or all text in editor
		let text: string;
		if (editor.selection.isEmpty) {
			text = editor.document.getText();	// entire editor/doc window
		} else {
			text = editor.document.getText(editor.selection);	// highlighted text
		} 

		// TODO: make this a try sequence to only parse the json once
		let jsonText: object;
		if(utils.isValidJson(text)){
			jsonText = JSON.parse(text);
		} else {
			vscode.window.showWarningMessage(`Not valid json object`);
			return;
		}
		
		const response = await f5FastApi.deployFastApp(jsonText);

		if (ext.settings.previewResponseInUntitledDocument) {
			utils.displayJsonInEditor(response.data);
		} else {
			WebViewPanel.render(context.extensionPath, response.data);
		}

		// give a little time to finish before refreshing trees
		await new Promise(resolve => { setTimeout(resolve, 3000); });
		fastTreeProvider.refresh();
		as3TenantTree.refresh();
	}));


	context.subscriptions.push(vscode.commands.registerCommand('f5-fast.getApp', async (tenApp) => {

		await ext.mgmtClient.getToken();
		const task: any = await ext.mgmtClient.makeRequest(`/mgmt/shared/fast/applications/${tenApp}`);

		if (ext.settings.previewResponseInUntitledDocument) {
			utils.displayJsonInEditor(task.data);
		} else {
			WebViewPanel.render(context.extensionPath, task.data);
		}
	}));


	context.subscriptions.push(vscode.commands.registerCommand('f5-fast.getTask', async (taskId) => {

		await ext.mgmtClient.getToken();
		const task: any = await ext.mgmtClient.makeRequest(`/mgmt/shared/fast/tasks/${taskId}`);

		if (ext.settings.previewResponseInUntitledDocument) {
			utils.displayJsonInEditor(task.data);
		} else {
			WebViewPanel.render(context.extensionPath, task.data);
		}
	}));


	context.subscriptions.push(vscode.commands.registerCommand('f5-fast.getTemplate', async (template) => {

		await ext.mgmtClient.getToken();
		const resp: any = await ext.mgmtClient.makeRequest(`/mgmt/shared/fast/templates/${template}`);

		if (ext.settings.previewResponseInUntitledDocument) {
			utils.displayJsonInEditor(resp.data);
		} else {
			WebViewPanel.render(context.extensionPath, resp.data);
		}

	}));

	context.subscriptions.push(vscode.commands.registerCommand('f5-fast.getTemplateSets', async (set) => {

		await ext.mgmtClient.getToken();
		const resp: any = await ext.mgmtClient.makeRequest(`/mgmt/shared/fast/templatesets/${set}`);

		if (ext.settings.previewResponseInUntitledDocument) {
			utils.displayJsonInEditor(resp.data);
		} else {
			WebViewPanel.render(context.extensionPath, resp.data);
		}

	}));


	context.subscriptions.push(vscode.commands.registerCommand('f5-fast.convJson2Mst', async () => {

		// get editor window
		var editor = vscode.window.activeTextEditor;
		if (!editor) {	return; // No open text editor
		}

		// capture selected text or all text in editor
		let text: string;
		if (editor.selection.isEmpty) {
			text = editor.document.getText();	// entire editor/doc window
		} else {
			text = editor.document.getText(editor.selection);	// highlighted text
		} 

		console.log(JSON.stringify(text));

		if(utils.isValidJson(text)){

			//TODO:  parse object and find the level for just ADC,
			//		need to remove all the AS3 details since fast will handle that
			// - if it's an object and it contains "class" key and value should be "Tenant"
			utils.displayMstInEditor(JSON.parse(text));
		} else {
			vscode.window.showWarningMessage(`not valid json object`);
		}


	}));

	context.subscriptions.push(vscode.commands.registerCommand('f5-fast.postTemplate', async (sFile) => {

		let text: string | Buffer;

		if(!sFile) {
			// not right click from explorer view, so gather file details

			// get editor window
			var editor = vscode.window.activeTextEditor;
			if (!editor) {	
				return; // No open text editor
			}

			// capture selected text or all text in editor
			if (editor.selection.isEmpty) {
				text = editor.document.getText();	// entire editor/doc window
			} else {
				text = editor.document.getText(editor.selection);	// highlighted text
			} 
		} else {
			// right click from explorer view, so load file contents
			const fileContents = fs.readFileSync(sFile.fsPath);
			// convert from buffer to string
			text = fileContents.toString('utf8');
		}

		await f5FastUtils.zipPostTemplate(text);

		await new Promise(resolve => { setTimeout(resolve, 1000); });
		fastTreeProvider.refresh();
	}));

	context.subscriptions.push(vscode.commands.registerCommand('f5-fast.postTemplateSet', async (sPath) => {

		console.log('postTemplateSet selection', sPath);
		let wkspPath;
		let selectedFolder;
		
		if(!sPath) {
			// didn't get a path passed in from right click, so we have to gather necessary details

			// get list of open workspaces
			const workspaces: vscode.WorkspaceFolder[] | undefined= vscode.workspace.workspaceFolders;
			console.log('workspaces', workspaces);
			
			// if no open workspace...
			if(!workspaces) {
				// Show message to select workspace
				await vscode.window.showInformationMessage('See top bar to open a workspace with Fast Templates first');
				// pop up to selecte a workspace
				await vscode.window.showWorkspaceFolderPick();
				// return to begining of function to try again
				return vscode.commands.executeCommand('f5-fast.postTemplateSet');
			}
		
			const folder1 = vscode.workspace.workspaceFolders![0]!.uri;
			wkspPath = folder1.fsPath;
			const folder2 = await vscode.workspace.fs.readDirectory(folder1);
		
			// console.log('workspace', vscode.workspace);
			console.log('workspace name', vscode.workspace.name);
			
			/**
			 * having problems typing the workspaces to a list for quick pick
			 * todo: get the following working
			 */
			// let wkspc;
			// if (workspaces.length > 1) {
			// 	// if more than one workspace open, have user select the workspace
			// 	wkspc = await vscode.window.showQuickPick(workspaces);
			// } else {
			// 	// else select the first workspace
			// 	wkspc = workspaces[0];
			// }
			
			let wFolders = [];
			for (const [name, type] of await vscode.workspace.fs.readDirectory(folder1)) {

				if (type === vscode.FileType.Directory){
					console.log('---directory', name);
					wFolders.push(name);
				}
			};

			// have user select first level folder in workspace
			selectedFolder = await vscode.window.showQuickPick(wFolders);
			
			if(!selectedFolder) {
				// if user "escaped" folder selection window
				return vscode.window.showInformationMessage('Must select a Fast Template Set folder');
			}
			console.log('workspace path', wkspPath);
			console.log('workspace folder', selectedFolder);
			selectedFolder = path.join(wkspPath, selectedFolder);

		} else {
			console.log('caught selected path');
			selectedFolder = sPath.fsPath;
		}

		await f5FastUtils.zipPostTempSet(selectedFolder);

		await new Promise(resolve => { setTimeout(resolve, 3000); });
		fastTreeProvider.refresh();
	}));

	context.subscriptions.push(vscode.commands.registerCommand('f5-fast.deleteFastApp', async (tenApp) => {
		
		// var device: string | undefined = ext.hostStatusBar.text;
		// const password = await utils.getPassword(device);
		const response = await f5FastApi.delTenApp(tenApp.label);

		if (ext.settings.previewResponseInUntitledDocument) {
			utils.displayJsonInEditor(response.data);
		} else {
			WebViewPanel.render(context.extensionPath, response.data);
		}
	
		// give a little time to finish
		await new Promise(resolve => { setTimeout(resolve, 2000); });
		fastTreeProvider.refresh();
		as3TenantTree.refresh();
	}));


	context.subscriptions.push(vscode.commands.registerCommand('f5-fast.deleteFastTempSet', async (tempSet) => {

		const resp = await f5FastApi.delTempSet(tempSet.label);

		vscode.window.showInformationMessage(`Fast Template Set Delete: ${resp.data.message}`);

		// give a little time to finish
		await new Promise(resolve => { setTimeout(resolve, 1000); });
		fastTreeProvider.refresh();
	}));


	context.subscriptions.push(vscode.commands.registerCommand('f5-fast.renderYmlTemplate', async () => {

		/**
		 * this is working through the f5 fast template creating process
		 * https://clouddocs.f5.com/products/extensions/f5-appsvcs-templates/latest/userguide/template-authoring.html
		 * 
		 * I think I was trying to take in a params.yml file to feed into an .mst file to test the output before
		 * 		being able to upload to fast as a template
		 */

		var editor = vscode.window.activeTextEditor;
		if (!editor) {	return; // No open text editor
		}

		let text: string;
		if (editor.selection.isEmpty) {
			text = editor.document.getText();	// entire editor/doc window
		} else {
			text = editor.document.getText(editor.selection);	// highlighted text
		} 

		// const templateEngine = await fast.Template.loadYaml(text);

		// const schema = templateEngine.getParametersSchema();
		// // const view = {};
		// const htmlData = fast.guiUtils.generateHtmlPreview(schema, {});
		// displayWebView(htmlData);
		// f5FastUtils.templateFromYaml(text);

	}));


	context.subscriptions.push(vscode.commands.registerCommand('f5-fast.renderHtmlPreview', async () => {

		/**
		 * this view is requested by zinke as part of the template authoring process
		 * 	The view should consume/watch the yml file that defines the user inputs for the template
		 * 	Every time a save occurs, it should refresh with the changes to streamline the authoring process
		 */

		var editor = vscode.window.activeTextEditor;
		if (!editor) {	return; // No open text editor
		}

		let text: string;
		if (editor.selection.isEmpty) {
			text = editor.document.getText();	// entire editor/doc window
		} else {
			text = editor.document.getText(editor.selection);	// highlighted text
		} 

		const templateEngine = await fast.Template.loadYaml(text);

		const schema = templateEngine.getParametersSchema();

		const htmlData = fast.guiUtils.generateHtmlPreview(schema, {});
		FastWebViewPanel.render(context.extensionPath, htmlData);
		// f5FastUtils.renderHtmlPreview(text);

	}));





	
	
	/**
	 * ############################################################################
	 * 
	 * 				  AAA     SSSSS   333333  
	 * 				 AAAAA   SS          3333 
	 * 				AA   AA   SSSSS     3333  
	 * 				AAAAAAA       SS      333 
	 * 				AA   AA   SSSSS   333333  
	 * 
	 * ############################################################################
	 * http://patorjk.com/software/taag/#p=display&h=0&f=Letters&t=AS3
	 */

	
	// setting up as3 tree
	const as3TenantTree = new AS3TenantTreeProvider('');
	vscode.window.registerTreeDataProvider('as3Tenants', as3TenantTree);
	vscode.commands.registerCommand('f5-as3.refreshTenantsTree', () => as3TenantTree.refresh());
	
	context.subscriptions.push(vscode.commands.registerCommand('f5-as3.getDecs', async (tenant) => {

		// set blank value if not defined -> get all tenants dec
		tenant = tenant ? tenant : '';

		await ext.mgmtClient.getToken();
		const resp: any = await ext.mgmtClient.makeRequest(`/mgmt/shared/appsvcs/declare/${tenant}`);
		utils.displayJsonInEditor(resp.data);

	}));


	context.subscriptions.push(vscode.commands.registerCommand('f5-as3.fullTenant', async (tenant) => {
		vscode.commands.executeCommand('f5-as3.getDecs', `${tenant.label}?show=full`);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('f5-as3.expandedTenant', async (tenant) => {
		vscode.commands.executeCommand('f5-as3.getDecs', `${tenant.label}?show=expanded`);
	}));
	
	
	context.subscriptions.push(vscode.commands.registerCommand('f5-as3.deleteTenant', async (tenant) => {
		
	    const progress = await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: `Deleting ${tenant.label} Tenant`
		}, async (progress) => {
			await ext.mgmtClient.getToken();
			const resp: any = await ext.mgmtClient.makeRequest(`/mgmt/shared/appsvcs/declare/${tenant.label}`, {
				method: 'DELETE'
			});
			const resp2 = resp.data.results[0];
			progress.report({message: `${resp2.code} - ${resp2.message}`});
			// hold the status box for user and let things finish before refresh
			await new Promise(resolve => { setTimeout(resolve, 5000); });
		});

		as3TenantTree.refresh();
	}));

	context.subscriptions.push(vscode.commands.registerCommand('f5-as3.getTask', (id) => {

		vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: `Getting AS3 Task`
		}, async () => {
			await ext.mgmtClient.getToken();
			const resp: any = await ext.mgmtClient.makeRequest(`/mgmt/shared/appsvcs/task/${id}`);
			utils.displayJsonInEditor(resp.data);
		});

	}));

	context.subscriptions.push(vscode.commands.registerCommand('f5-as3.postDec', async () => {

		// var device: string | undefined = ext.hostStatusBar.text;
		ext.as3AsyncPost = vscode.workspace.getConfiguration().get('f5.as3Post.async');
		// const postParam: string | undefined = vscode.workspace.getConfiguration().get('f5.as3Post.async');

		let postParam;
		if(ext.as3AsyncPost) {
			postParam = 'async=true';
		} else {
			postParam = undefined;
		}

		var editor = vscode.window.activeTextEditor;
		if (!editor) {
			return; // No open text editor
		}

		let text: string;
		if (editor.selection.isEmpty) {
			text = editor.document.getText();	// entire editor/doc window
		} else {
			text = editor.document.getText(editor.selection);	// highlighted text
		} 

		if (!utils.isValidJson(text)) {
			return vscode.window.showErrorMessage('Not valid JSON object');
		}

		// use the following logic to implement robust async
		// https://github.com/vinnie357/demo-gcp-tf/blob/add-glb-targetpool/terraform/gcp/templates/as3.sh
		const resp = await f5Api.postAS3Dec(postParam, JSON.parse(text));

		if (ext.settings.previewResponseInUntitledDocument) {
			utils.displayJsonInEditor(resp.data);
		} else {
			WebViewPanel.render(context.extensionPath, resp.data);
		}
		as3TenantTree.refresh();
		// as3Tree.refresh();
	}));


	/**
	 * experimental - this feature is intented to grab the current json object declaration in the editor,
	 * 		try to figure out if it's as3/do/ts, then apply the appropriate schema reference in the object
	 * 	if it detects the schema already there, it will remove it.
	 */
	context.subscriptions.push(vscode.commands.registerCommand('f5.injectSchemaRef', async () => {

		vscode.window.showWarningMessage('experimental feature in development');
		
		var editor = vscode.window.activeTextEditor;
		if (!editor) {
			return; // No open text editor
		}

		let text: string;
		if (editor.selection.isEmpty) {
			text = editor.document.getText();	// entire editor/doc window
		} else {
			text = editor.document.getText(editor.selection);	// highlighted text
		} 

		if (!utils.isValidJson(text)) {
			return vscode.window.showErrorMessage('Not valid JSON object');
		}
		
		var newText = JSON.parse(text);
		if(!newText.hasOwnProperty('$schema')) {
			//if it has the class property, see what it is
			if(newText.hasOwnProperty('class') && newText.class === 'AS3') {
				newText['$schema'] = git.latestAS3schema;

			} else if (newText.hasOwnProperty('class') && newText.class === 'Device') {
				newText['$schema'] = git.latestDOschema;
				
			} else if (newText.hasOwnProperty('class') && newText.class === 'Telemetry') {
				newText['$schema'] = git.latestTSschema;
			} else {
				vscode.window.showInformationMessage(`Could not find base declaration class for as3/do/ts`);
			}
		} else {
			vscode.window.showInformationMessage(`Removing ${newText.$schema}`);
			delete newText.$schema;

		}

		console.log(`newText below`);
		console.log(newText);

		const {activeTextEditor} = vscode.window;

        if (activeTextEditor && activeTextEditor.document.languageId === 'json') {
            const {document} = activeTextEditor;
			const firstLine = document.lineAt(0);
			const lastLine = document.lineAt(document.lineCount - 1);
			var textRange = new vscode.Range(0,
			firstLine.range.start.character,
			document.lineCount - 1,
			lastLine.range.end.character);
			editor.edit( edit => {
				edit.replace(textRange, newText);
			});
            // if (firstLine.text !== '42') {
            //     const edit = new vscode.WorkspaceEdit();
            //     edit.insert(document.uri, firstLine.range.start, '42\n');
            //     return vscode.workspace.applyEdit(edit)
            // }
        }
		// const { activeTextEditor } = vscode.window;
		// const { document } = activeTextEditor;

		// const fullText = document.getText();
		// const fullRange = new vscode.Range(
		// 	document.positionAt(0),
		// 	document.positionAt(fullText.length - 1)
		// )

		// let invalidRange = new Range(0, 0, textDocument.lineCount /*intentionally missing the '-1' */, 0);
		// let fullRange = textDocument.validateRange(invalidRange);
		// editor.edit(edit => edit.replace(fullRange, newText));
		
		// editor.edit(edit => {
		// 	const startPosition = new Position(0, 0);
		// 	const endPosition = vscode.TextDocument.lineAt(document.lineCount - 1).range.end;
		// 	edit.replace(new Range(startPosition, endPosition), newText);
		// });

		// var firstLine = textEdit.document.lineAt(0);
		// var lastLine = textEditor.document.lineAt(textEditor.document.lineCount - 1);
		// var textRange = new vscode.Range(0,
		// firstLine.range.start.character,
		// textEditor.document.lineCount - 1,
		// lastLine.range.end.character);

		// textEditor.edit(function (editBuilder) {
		// 	editBuilder.replace(textRange, '$1');
		// });


		// editor.edit(builder => builder.replace(textRange, newText));
		// });

	}));







	/**
	 * #########################################################################
	 * 
	 *			 TTTTTTT  SSSSS  	
	 *			   TTT   SS      	
	 *			   TTT    SSSSS  	
	 *			   TTT        SS 	
	 *			   TTT    SSSSS  	
	 * 	
	 * http://patorjk.com/software/taag/#p=display&h=0&f=Letters&t=TS
	 * http://patorjk.com/software/taag/#p=display&h=0&f=ANSI%20Regular&t=TS
	 * #########################################################################
	 * 
	 */




	context.subscriptions.push(vscode.commands.registerCommand('f5-ts.info', async () => {
		await ext.mgmtClient.getToken();
		const resp: any = await ext.mgmtClient.makeRequest('/mgmt/shared/telemetry/info');
		utils.displayJsonInEditor(resp.data);
	}));


	context.subscriptions.push(vscode.commands.registerCommand('f5-ts.getDec', async () => {
		await ext.mgmtClient.getToken();
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: `Getting TS Dec`
		}, async () => {
			const resp: any = await ext.mgmtClient.makeRequest(`/mgmt/shared/telemetry/declare`);
			utils.displayJsonInEditor(resp.data.declaration);
		});
	}));

	context.subscriptions.push(vscode.commands.registerCommand('f5-ts.postDec', async () => {
		
		// if selected text, capture that, if not, capture entire document
		var editor = vscode.window.activeTextEditor;
		let text: string;
		if(editor) {
			if (editor.selection.isEmpty) {
				text = editor.document.getText();	// entire editor/doc window
			} else {
				text = editor.document.getText(editor.selection);	// highlighted text
			} 

			if (!utils.isValidJson(text)) {
				return vscode.window.showErrorMessage('Not valid JSON object');
			}
		}

		const progress = await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: `Posting TS Dec`
		}, async () => {
			await ext.mgmtClient.getToken();
			const resp: any = await ext.mgmtClient.makeRequest(`/mgmt/shared/telemetry/declare`, {
				method: 'POST',
				body: JSON.parse(text)
			});
			utils.displayJsonInEditor(resp.data);
		});
	}));

	context.subscriptions.push(vscode.commands.registerCommand('f5.getGitHubExample', async (decUrl) => {

		const gitIssueUrl = 'https://github.com/F5Networks/f5-appsvcs-extension/issues/280';

		if(decUrl === 'tempAS3') {
			// remove once as3 examples are available
			return vscode.env.openExternal(vscode.Uri.parse(gitIssueUrl));
		}

		decUrl = vscode.Uri.parse(decUrl);
		const decCall = await callHTTPS({
		    method: 'GET',
		    host: decUrl.authority,
		    path: decUrl.path,
		    headers: {
		        'Content-Type': 'application/json',
		        'User-Agent': 'nodejs native HTTPS'
		    }
		}).then( resp => {
			return resp;
		});

		utils.displayJsonInEditor(decCall.body);
	}));





/**
 * #########################################################################
 * 
 * 			 █████    ██████  
 *			 ██   ██ ██    ██ 
 *			 ██   ██ ██    ██ 
 *			 ██   ██ ██    ██ 
 *			 █████    ██████  
 * 			
 * #########################################################################
 * 	http://patorjk.com/software/taag/#p=display&h=0&f=ANSI%20Regular&t=DO
 */

	context.subscriptions.push(vscode.commands.registerCommand('f5-do.getDec', async () => {

		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: `Getting DO Dec`
		}, async () => {
			await ext.mgmtClient.getToken();
			const resp: any = await ext.mgmtClient.makeRequest(`/mgmt/shared/declarative-onboarding/`);
			utils.displayJsonInEditor(resp.data.declaration);
		});


	}));

	context.subscriptions.push(vscode.commands.registerCommand('f5-do.postDec', async () => {

		var editor = vscode.window.activeTextEditor;
		if (!editor) {
			return; // No open text editor
		}

		let text: string;
		if (editor.selection.isEmpty) {
			text = editor.document.getText();	// entire editor/doc window
		} else {
			text = editor.document.getText(editor.selection);	// highlighted text
		} 

		if (!utils.isValidJson(text)) {
			return vscode.window.showErrorMessage('Not valid JSON object');
		}

		const resp = await f5Api.postDoDec(JSON.parse(text));
		utils.displayJsonInEditor(resp.data);

	}));


	context.subscriptions.push(vscode.commands.registerCommand('f5-do.inspect', async () => {

		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: `Getting DO Inspect`
		}, async () => {
			await ext.mgmtClient.getToken();
			const resp: any = await ext.mgmtClient.makeRequest(`/mgmt/shared/declarative-onboarding/inspect`);
			utils.displayJsonInEditor(resp.data);
		}); 

	}));



	context.subscriptions.push(vscode.commands.registerCommand('f5-do.getTasks', async () => {

		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: `Getting DO Tasks`
		}, async () => {
			await ext.mgmtClient.getToken();
			const resp: any = await ext.mgmtClient.makeRequest(`/mgmt/shared/declarative-onboarding/task`);
			utils.displayJsonInEditor(resp.data);
		});
	}));





/**
 * #########################################################################
 * 
 * 		UU   UU  TTTTTTT  IIIII  LL      
 * 		UU   UU    TTT     III   LL      
 * 		UU   UU    TTT     III   LL      
 * 		UU   UU    TTT     III   LL      
 * 		 UUUUU     TTT    IIIII  LLLLLLL 
 * 
 * #########################################################################
 * http://patorjk.com/software/taag/#p=display&h=0&f=Letters&t=UTIL
 */


	// register example delarations tree
	vscode.window.registerTreeDataProvider('decExamples', new ExampleDecsProvider());


	context.subscriptions.push(vscode.commands.registerCommand('f5.jsonYmlConvert', async () => {
		const editor = vscode.window.activeTextEditor;
		if(!editor) {
			return;
		}
		const selection = editor.selection;	
		const text = editor.document.getText(editor.selection);	// highlighted text

		
		let newText: string;
		if (utils.isValidJson(text)) {
			console.log('converting json -> yaml');
			// since it was valid json -> dump it to yaml
			newText = jsYaml.safeDump(JSON.parse(text), {indent: 4});
		} else {
			console.log('converting yaml -> json');
			newText = JSON.stringify(jsYaml.safeLoad(text), undefined, 4);
		}

		editor.edit( editBuilder => {
			editBuilder.replace(selection, newText);
		});
	}));

	/**
	 * refactor the json<->yaml/base64-encode/decode stuff to follow the following logic
	 * based off of the vscode-extension-examples document-editing-sample
	 */
	// let disposable = vscode.commands.registerCommand('extension.reverseWord', function () {
	// 	// Get the active text editor
	// 	let editor = vscode.window.activeTextEditor;

	// 	if (editor) {
	// 		let document = editor.document;
	// 		let selection = editor.selection;

	// 		// Get the word within the selection
	// 		let word = document.getText(selection);
	// 		let reversed = word.split('').reverse().join('');
	// 		editor.edit(editBuilder => {
	// 			editBuilder.replace(selection, reversed);
	// 		});
	// 	}
	// });

	context.subscriptions.push(vscode.commands.registerCommand('f5.b64Encode', () => {
		const editor = vscode.window.activeTextEditor;
		if(!editor){
			return;
		}
		const text = editor.document.getText(editor.selection);	// highlighted text
		const encoded = Buffer.from(text).toString('base64');
		editor.edit( editBuilder => {
			editBuilder.replace(editor.selection, encoded);
		});
	}));


	context.subscriptions.push(vscode.commands.registerCommand('f5.b64Decode', () => {
		const editor = vscode.window.activeTextEditor;
		if(!editor){
			return;
		}
		const text = editor.document.getText(editor.selection);	// highlighted text
		const decoded = Buffer.from(text, 'base64').toString('ascii');
		editor.edit( editBuilder => {
			editBuilder.replace(editor.selection, decoded);
		});
	}));


	context.subscriptions.push(vscode.commands.registerCommand('chuckJoke', async () => {
		chuckJoke1();
	}));

}


// this method is called when your extension is deactivated
export function deactivate() {}
