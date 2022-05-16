/*
 * Created with @iobroker/create-adapter v2.1.1
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
import * as utils from "@iobroker/adapter-core";
// Load your modules here, e.g.:
import axios, { AxiosInstance } from "axios";
import https from "https";
import { DOMParser } from "xmldom";
import xpath from "xpath";
import { State } from "./lib/State";
import { StatesMapper } from "./StatesMapper";

class KostalPikoMpPlus extends utils.Adapter {
    refreshInterval: any = undefined;
    hostIpRegex = /^http[s]?:\/\/[A-Za-z0-9\.]+(:[0-9]{1,})?$/;

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({
            ...options,
            name: "kostal-piko-mp-plus",
        });
        this.on("ready", this.onReady.bind(this));
        this.on("unload", this.onUnload.bind(this));
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    private async onReady(): Promise<void> {
        // Initialize your adapter here
        // Reset the connection indicator during startup
        this.setState("info.connection", false, true);

        // The adapters config (in the instance object everything under the attribute "native") is accessible via this.config:
        this.log.debug(`config.serverIp: ${this.config.serverIp}`);
        this.log.debug(`config.interval: ${this.config.interval}`);

        if (!this.hostIpRegex.test(this.config.serverIp)) {
            this.log.error(`config.serverIp: ${this.config.serverIp} is invalid - example http://192.168.0.100`);
            return;
        }

        // Load states config
        const states = StatesMapper.states;

        const client = axios.create({
            baseURL: `${this.config.serverIp}`,
            timeout: 5000,
            responseType: "text",
            responseEncoding: "utf8",
            httpsAgent: new https.Agent({
                rejectUnauthorized: false,
            }),
        });

        this.log.info(`axios client with base url ${this.config.serverIp} created`);
        this.log.info(`init fetch states`);

        try {
            await this.refreshMeasurements(client, states);

            this.log.info(`starting auto refresh each ${this.config.interval} millis`);
            this.refreshInterval = this.setInterval(async () => {
                this.log.info(`refreshing states`);
                await this.refreshMeasurements(client, states);
            }, this.config.interval);
        } catch (error) {
            this.log.error(`set connection state to false and stop interval`);
            this.setState("info.connection", false, true);
            this.clearInterval(this.refreshInterval);
            if (axios.isAxiosError(error)) {
                this.log.error(`error message: ${error.message} - ${error.response?.data}`);
            } else {
                this.log.error(`unexpected error: ${error}`);
            }
        }
    }

    private async refreshMeasurements(client: AxiosInstance, states: State[]): Promise<void> {
        const { data, status } = await client.get("/measurements.xml");
        this.log.debug(`request to /measurements.xml with status ${status}`);
        if (status == 200) {
            this.setState("info.connection", true, true);
            const dom = new DOMParser().parseFromString(data);
            await this.updateStates(dom, states);
        } else {
            this.log.error(`unexpected status code: ${status}`);
        }
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
                this.log.debug(`found state ${s.id} - ${value}`);
                const common: ioBroker.StateCommon = {
                    name: s.name,
                    type: s.type ? s.type : "string",
                    read: s.read ? s.read : true,
                    write: s.write ? s.write : false,
                    role: s.role ? s.role : "state",
                    unit: unit !== null ? unit : undefined,
                };

                await this.setObjectNotExistsAsync(s.id, {
                    type: "state",
                    common: common,
                    native: {},
                });

                value = this.convertStringTo(value, common.type);

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
            this.setState("info.connection", false, true);
            this.clearInterval(this.refreshInterval);
            callback();
        } catch (e) {
            callback();
        }
    }

    private convertStringTo(value: string, typeString: string | undefined): any {
        this.log.debug(`try to convert ${value} to ${typeString}`);

        let convertedValue: any;
        if (typeString == "number") {
            convertedValue = Number(value);
        } else if (typeString == "string") {
            convertedValue = value;
        } else {
            throw new Error(`unknown cast type - ${typeString}`);
        }
        return convertedValue;
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new KostalPikoMpPlus(options);
} else {
    // otherwise start the instance directly
    (() => new KostalPikoMpPlus())();
}
