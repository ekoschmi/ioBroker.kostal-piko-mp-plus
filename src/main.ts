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
    refreshTimeout: any = undefined;
    serverIpRegex = /^[A-Za-z0-9\.]+$/;
    failCounter = 0;

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
        this.log.debug(`config.serverProtocol: ${this.config.serverProtocol}`);
        this.log.debug(`config.serverIp: ${this.config.serverIp}`);
        this.log.debug(`config.serverPort: ${this.config.serverPort}`);
        this.log.debug(`config.interval: ${this.config.interval}`);

        if (this.serverIpRegex.test(this.config.serverIp)) {
            const serverBaseUrl = `${this.config.serverProtocol}://${this.config.serverIp}:${this.config.serverPort}`;

            // Load states config
            const states = StatesMapper.states;
            this.generateMdStateTable(states);

            this.log.debug(`create http client with baseURL: ${serverBaseUrl}`);
            const client = this.createClient(serverBaseUrl);

            this.log.debug(`axios client with base url ${serverBaseUrl} created`);
            await this.refreshMeasurements(client, states);
        } else {
            this.log.error(`Server IP/Host: ${this.config.serverIp} is invalid - example 192.168.0.1`);
        }
    }

    private createClient(serverBaseUrl: string): AxiosInstance {
        return axios.create({
            baseURL: `${serverBaseUrl}`,
            timeout: 5000,
            responseType: "text",
            responseEncoding: "utf8",
            httpsAgent: new https.Agent({
                rejectUnauthorized: false,
            }),
        });
    }

    private async refreshMeasurements(client: AxiosInstance, states: State[]): Promise<void> {
        const endpoint = "/all.xml";
        let failed = false;
        try {
            this.log.debug(`refreshing states`);
            const { data, status } = await client.get(endpoint);
            this.log.debug(`request to ${endpoint} with status ${status}`);
            if (status == 200) {
                this.setState("info.connection", true, true);
                const dom = new DOMParser().parseFromString(data);
                await this.updateStates(dom, states);
                this.log.debug(`create refresh timer`);
                this.refreshTimeout = this.setTimeout(
                    () => this.refreshMeasurements(client, states),
                    this.config.interval,
                );
            } else {
                this.log.error(`unexpected status code: ${status}`);
                this.setState("info.connection", false, true);
                failed = true;
            }
        } catch (error) {
            this.log.error(`set connection state to false`);
            this.setState("info.connection", false, true);
            if (axios.isAxiosError(error)) {
                this.log.error(`error message: ${error.message}${error.response ? " - " + error.response.data : ""}`);
            } else {
                this.log.error(`unexpected error: ${error}`);
            }
            failed = true;
        }

        if (failed) {
            this.failCounter++;
            if (this.failCounter <= this.config.failCount) {
                this.log.info(
                    `Retry ${this.failCounter} from ${this.config.failCount} in ${this.config.failTimeout} ms`,
                );
                this.refreshTimeout = this.setTimeout(
                    () => this.refreshMeasurements(client, states),
                    this.config.failTimeout,
                );
            } else {
                this.log.error(
                    `Hmm, too bad then let's leave it at that. Please check if the Kostal Piko MP Plus is really available under the settings you made in the preferences.`,
                );
            }
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
                const common: ioBroker.StateCommon = this.createStateCommonFromState(s, unit);

                await this.setObjectNotExistsAsync(s.id, { type: "state", common: common, native: {} });

                value = this.convertStringTo(value, common.type);

                await this.setStateAsync(s.id, { val: value, ack: true });
            } else {
                this.log.debug(`${s.id} has no value so we ignore it`);
            }
        }
    }

    private createStateCommonFromState(s: State, unit: string | null): ioBroker.StateCommon {
        return {
            name: s.name,
            type: s.type ? s.type : "string",
            read: s.read ? s.read : true,
            write: s.write ? s.write : false,
            role: s.role ? s.role : "state",
            unit: unit !== null ? unit : undefined,
        };
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     */
    private onUnload(callback: () => void): void {
        try {
            this.setState("info.connection", false, true);
            this.clearTimeout(this.refreshTimeout);
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

    private generateMdStateTable(states: State[]): void {
        let table: string;
        table = `\n|Id|Name|Value Type|xPath Value|xPath Unit|\n`;
        table = `${table}|---|---|---|---|---|\n`;
        states.forEach((e) => {
            table = `${table}|${e.id}|${e.name}|${e.type ? e.type : "string"}|${e.xpathValue}|${
                e.xpathUnit ? e.xpathUnit : "-"
            }|\n`;
        });
        this.log.debug(`${table}`);
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new KostalPikoMpPlus(options);
} else {
    // otherwise start the instance directly
    (() => new KostalPikoMpPlus())();
}
