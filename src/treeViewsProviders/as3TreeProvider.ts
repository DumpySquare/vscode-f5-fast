import {
	Command,
	Event,
	EventEmitter,
	TreeDataProvider,
	TreeItem,
	TreeItemCollapsibleState
} from 'vscode';
import { ext } from '../extensionVariables';


export class AS3TreeProvider implements TreeDataProvider<AS3item> {

	private _onDidChangeTreeData: EventEmitter<AS3item | undefined> = new EventEmitter<AS3item | undefined>();
	readonly onDidChangeTreeData: Event<AS3item | undefined> = this._onDidChangeTreeData.event;

	private _tenants: any[] = [];
	private _bigiqTenants: any = [];
	private _tasks: string[] = [];

	constructor() {
	}

	refresh(): void {
		this._bigiqTenants = [];
		this._tenants = [];
		this._tasks = [];
		this._onDidChangeTreeData.fire(undefined);
	}

	getTreeItem(element: AS3item): TreeItem {
		return element;
	}

	async getChildren(element?: AS3item) {
		let treeItems: AS3item[] = [];

		if (ext.as3Bar.text) {

			if (element) {

				if (element.label === 'Targets') {


					treeItems = this._bigiqTenants.map((el: { target: string; tensList: any[]; }) => {
						const targetTenCount = el.tensList.length.toString();
						return new AS3item(el.target, targetTenCount, '', '', TreeItemCollapsibleState.Collapsed,
							{ command: '', title: '', arguments: el.tensList });
					});

				} else if (element.label === 'Tenants') {

					let tenant: string;
					let target: string;
					treeItems = this._tenants.map((el) => {

						// loop through the items in the object, find the declaration,
						// 	return the tenant(key) (should only be one)
						Object.entries(el).forEach(([key, val]) => {
							// is the item an object and has a 'class' property?
							if (typeof val === 'object' && val?.hasOwnProperty('class')) {

								// typecast the object class property to be a string
								const tenAntNew = (val as { class: string });

								// is it the 'Tenant' class? -> means its the declaration, so return the key as the tenant name
								if (tenAntNew.class === 'Tenant') {
									tenant = key;
								}
							}

							// if key of this object property is a target
							target = key === 'target'
								// typecast val as an object with address property of string, then return the address string in a templated string
								? `target -> ${(val as { address: string }).address}`
								// else, make it blank
								: '';
						});

						return new AS3item(tenant, target, '', 'as3Tenant', TreeItemCollapsibleState.None,
							{ command: 'f5-as3.getDecs', title: 'Get Tenant Declaration', arguments: [el] });
					});

				} else if (element.label === 'Tasks') {

					treeItems = this._tasks.map((task: any) => {
						return new AS3item(task.iId.split('-').pop(), task.timeStamp, '', '', TreeItemCollapsibleState.None,
							{ command: 'f5-as3.getTask', title: '', arguments: [task.iId] });
					});
				} else {

					// this should happen when a target is selected

					const x = element.command?.arguments?.map(el => {
						return new AS3item(el.label, '', '', 'as3Tenant', TreeItemCollapsibleState.None,
							{ command: 'f5-as3.getDecs', title: 'Get Tenant Declaration', arguments: [el] });
					});
					treeItems = x ? x : [];
				}

			} else {

				/**
				 * todo:  look at moving this to the refresh function, might cut back on how often it gets called
				 */
				await this.getTenants(); // refresh tenant information
				await this.getTasks();	// refresh tasks information


				const targetCount = this._bigiqTenants.length !== 0 ? this._bigiqTenants.length.toString() : '';
				const tenCount = this._tenants.length !== 0 ? this._tenants.length.toString() : '';
				const taskCount = this._tasks.length !== 0 ? this._tasks.length.toString() : '';

				// if we have bigiQ...
				if (this._bigiqTenants.length > 0) {
					treeItems.push(
						new AS3item('Targets', targetCount, '', '', TreeItemCollapsibleState.Collapsed,
							{ command: '', title: '', arguments: [''] })
					);
				}

				// if we have bigip
				if (this._tenants.length > 0) {
					treeItems.push(
						new AS3item('Tenants', tenCount, 'Get All Tenants', '', TreeItemCollapsibleState.Collapsed,
							{ command: 'f5-as3.getDecs', title: '', arguments: [''] })
					);
				}


				treeItems.push(
					new AS3item('Tasks', taskCount, 'Get All Tasks', '', TreeItemCollapsibleState.Collapsed,
						{ command: 'f5-as3.getTask', title: '', arguments: [''] })
				);
			}
		}
		return Promise.resolve(treeItems);
	}



	private async getTenants() {
		this._tenants = [];	// clear current tenant list
		this._bigiqTenants = [];	// clear current bigiq tenant list

		// await ext.f5Client?.as3?.getDecs()
		await ext.mgmtClient?.makeRequest(`/mgmt/shared/appsvcs/declare/`)
			.then((resp: any) => {

				// got an array, so this should be a bigiq list of devices with tenant information

				if (Array.isArray(resp.data)) {

					// loop through targets/devices
					this._bigiqTenants = resp.data.map((el: any) => {

						const target = el.target.address; // get target bigip

						const tensList: any[] = [];
						Object.entries(el).forEach(([key, val]) => {
							if (isObject(val) && key !== 'target' && key !== 'controls') {

								tensList.push({
									label: key,
									dec: val,
									target: el.target,
									id: el.id,
									schemaVersion: el.schemaVersion,
									updateMode: el.updateMode
								});
							}
						});

						return { target, tensList };
					});


				} else {

					let target;

					/**
					 * should be a single bigip tenants object
					 * 	loop through, return object keys 
					 */
					for (const [tenant, dec] of Object.entries(resp.data)) {

						if (isObject(dec) && tenant === 'target') {
							// Capture target if defined
							target = dec;
						}

						if (isObject(dec) && tenant !== 'controls' && tenant !== 'target') {
							// const target = dec.target?.address ? 
							// rebuild each tenant as3 dec
							const finalDec = {
								class: 'AS3',
								id: resp.data.id,
								schemaVersion: resp.data.schemaVersion,
								updateMode: resp.data.updateMode,
								[tenant]: dec
							};

							if (target) {
								// if we have a target, inject into tenant declaration
								finalDec.target = target;
							}
							this._tenants.push(finalDec);
						}
					}
				}
			});
	}

	private async getTasks() {
		// await ext.f5Client?.as3?.getTasks()
		await ext.mgmtClient?.makeRequest(`/mgmt/shared/appsvcs/task/`)
			.then((resp: any) => {
				this._tasks = [];	// clear current tenant list
				this._tasks = resp.data.items.map((item: any) => {
					// if no decs in task or none on box, it returns limited details, but the request still gets an ID, so we blank in what's not there - also happens when getting-tasks
					const timeStamp = item.declaration.hasOwnProperty('controls') ? item.declaration.controls.archiveTimestamp : '';
					const iId = item.id;

					return { iId, timeStamp };
				});
			});
	}

}

function isObject(x: any) {
	// return object(true) if json object
	return x === Object(x);
}

class AS3item extends TreeItem {
	constructor(
		public readonly label: string,
		public description: string,
		public tooltip: string,
		public context: string,
		public readonly collapsibleState: TreeItemCollapsibleState,
		public readonly command: Command,
	) {
		super(label, collapsibleState);
	}
	contextValue = this.context;
}