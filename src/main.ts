/*
 * Created with @iobroker/create-adapter v2.1.1
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
import * as utils from "@iobroker/adapter-core";
// Load your modules here, e.g.:
import axios from "axios";
import { DOMParser } from "xmldom";
import xpath from "xpath";
import { State } from "./lib/State";
import { StatesMapper } from "./StatesMapper";

class KostalPikoMpPlus extends utils.Adapter {
    refreshInterval: any = undefined;

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({
            ...options,
            name: "kostal-piko-mp-plus",
        });
        this.on("ready", this.onReady.bind(this));
        // this.on("stateChange", this.onStateChange.bind(this));
        // this.on("objectChange", this.onObjectChange.bind(this));
        // this.on("message", this.onMessage.bind(this));
        this.on("unload", this.onUnload.bind(this));
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    private async onReady(): Promise<void> {
        // Initialize your adapter here
        const states = StatesMapper.states;
        // Reset the connection indicator during startup
        this.setState("info.connection", false, true);

        // The adapters config (in the instance object everything under the attribute "native") is accessible via this.config:
        this.log.debug("config.serverIp: " + this.config.serverIp);
        this.log.debug("config.interval: " + this.config.interval);

        const requestURL = `${this.config.serverIp}/measurements.xml`;
        const requestHeader = { headers: { Accept: "application/xml" } };

        this.refreshInterval = this.setInterval(async () => {
            try {
                const { data, status } = await axios.get<string>(requestURL, requestHeader);

                this.setState("info.connection", true, true);

                this.log.debug(`request to ${requestURL} with status ${status}`);
                const dom = new DOMParser().parseFromString(data);
                await this.updateStates(dom, states);
            } catch (error) {
                this.setState("info.connection", false, true);
                this.clearInterval(this.refreshInterval);
                if (axios.isAxiosError(error)) {
                    this.log.error(`error message: ${error.message}`);
                } else {
                    this.log.error(`unexpected error: ${error}`);
                }
            }
        }, this.config.interval);

        /*
		For every state in the system there has to be also an object of type state
		Here a simple template for a boolean variable named "testVariable"
		Because every adapter instance uses its own unique namespace variable names can't collide with other adapters variables
		*/
        /*
        await this.setObjectNotExistsAsync("testVariable", {
            type: "state",
            common: {
                name: "testVariable",
                type: "boolean",
                role: "indicator",
                read: true,
                write: true,
            },
            native: {},
        });
        */
        // In order to get state updates, you need to subscribe to them. The following line adds a subscription for our variable we have created above.
        //this.subscribeStates("testVariable");
        // You can also add a subscription for multiple states. The following line watches all states starting with "lights."
        // this.subscribeStates("lights.*");
        // Or, if you really must, you can also watch all states. Don't do this if you don't need to. Otherwise this will cause a lot of unnecessary load on the system:
        // this.subscribeStates("*");

        /*
			setState examples
			you will notice that each setState will cause the stateChange event to fire (because of above subscribeStates cmd)
		*/
        // the variable testVariable is set to true as command (ack=false)
        //await this.setStateAsync("testVariable", true);

        // same thing, but the value is flagged "ack"
        // ack should be always set to true if the value is received from or acknowledged from the target system
        //await this.setStateAsync("testVariable", { val: true, ack: true });

        // same thing, but the state is deleted after 30s (getState will return null afterwards)
        //await this.setStateAsync("testVariable", { val: true, ack: true, expire: 30 });

        // examples for the checkPassword/checkGroup functions
        //let result = await this.checkPasswordAsync("admin", "iobroker");
        //this.log.info("check user admin pw iobroker: " + result);

        //result = await this.checkGroupAsync("admin", "admin");
        //this.log.info("check group user admin group admin: " + result);
    }

    private async updateStates(dom: Document, states: State[]): Promise<void> {
        for (const s of states) {
            let selectedValue = xpath.select1(s.xpathValue, dom);

            let value: any;

            if (selectedValue !== undefined) {
                value = (<Attr>selectedValue).value;
            }

            let unit = null;
            if (s.xpathUnit !== undefined) {
                selectedValue = xpath.select1(s.xpathUnit, dom);
                unit = (<Attr>selectedValue).value;
            }

            if (value !== undefined) {
                if (s.type == "number") {
                    value = Number(value);
                } else if (s.type == "string") {
                    this.log.debug(`${s.id}:${value} - it is a string then it remains a string`);
                } else {
                    this.log.error(`unknown cast type`);
                }
            }

            if (value !== undefined) {
                this.log.debug(`${s.id} has a value so we add this object with ${value} its ${typeof value}`);
                const common: ioBroker.StateCommon = {
                    name: s.name,
                    type: s.type,
                    read: s.read,
                    write: s.write,
                    role: "state",
                    unit: unit !== null ? unit : undefined,
                };

                await this.setObjectNotExistsAsync(s.id, {
                    type: "state",
                    common: common,
                    native: {},
                });
                await this.setStateAsync(s.id, { val: value, ack: true });
            } else {
                this.log.debug(`${s.id} has no value so we ignore it and we can delete it`);
                await this.delObjectAsync(s.id);
            }
        }
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     */
    private onUnload(callback: () => void): void {
        try {
            this.clearInterval(this.refreshInterval);
            // Here you must clear all timeouts or intervals that may still be active
            // clearTimeout(timeout1);
            callback();
        } catch (e) {
            callback();
        }
    }

    // If you need to react to object changes, uncomment the following block and the corresponding line in the constructor.
    // You also need to subscribe to the objects with `this.subscribeObjects`, similar to `this.subscribeStates`.
    // /**
    //  * Is called if a subscribed object changes
    //  */
    // private onObjectChange(id: string, obj: ioBroker.Object | null | undefined): void {
    //     if (obj) {
    //         // The object was changed
    //         this.log.info(`object ${id} changed: ${JSON.stringify(obj)}`);
    //     } else {
    //         // The object was deleted
    //         this.log.info(`object ${id} deleted`);
    //     }
    // }

    /**
     * Is called if a subscribed state changes
     */
    /*
    private onStateChange(id: string, state: ioBroker.State | null | undefined): void {
        if (state) {
            // The state was changed
            this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
        } else {
            // The state was deleted
            this.log.info(`state ${id} deleted`);
        }
    }
    */
    // If you need to accept messages in your adapter, uncomment the following block and the corresponding line in the constructor.
    // /**
    //  * Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
    //  * Using this method requires "common.messagebox" property to be set to true in io-package.json
    //  */
    // private onMessage(obj: ioBroker.Message): void {
    //     if (typeof obj === "object" && obj.message) {
    //         if (obj.command === "send") {
    //             // e.g. send email or pushover or whatever
    //             this.log.info("send command");

    //             // Send response in callback if required
    //             if (obj.callback) this.sendTo(obj.from, obj.command, "Message received", obj.callback);
    //         }
    //     }
    // }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new KostalPikoMpPlus(options);
} else {
    // otherwise start the instance directly
    (() => new KostalPikoMpPlus())();
}
