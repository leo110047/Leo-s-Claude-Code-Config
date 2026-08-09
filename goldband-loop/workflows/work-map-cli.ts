#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	executeWorkMapCreate,
	executeWorkMapLifecycle,
} from "./work-map-runtime";
import { TrackerRuntime } from "./tracker-runtime";
import {
	inspectTrackerConfiguration,
	parseTrackerConfiguration,
	TrackerConfigurationStore,
} from "./tracker-config";

async function main(args: string[]): Promise<void> {
	if (args[0] === "sync") {
		await trackerSync(args.slice(1));
		return;
	}
	let operation: "create" | "block" | "resume" | "cancel" = "create";
	if (args[0] === "block" || args[0] === "resume" || args[0] === "cancel") {
		operation = args.shift() as "block" | "resume" | "cancel";
	}
	let inputFile = "";
	let workId = "";
	let ticketId = "";
	let reason = "";
	let host: "claude" | "codex" | undefined;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--input") {
			if (inputFile) throw new Error("--input may be supplied only once");
			inputFile = args[index + 1] || "";
			index += 1;
			continue;
		}
		if (arg === "--host") {
			const value = args[index + 1];
			if (host || (value !== "claude" && value !== "codex")) {
				throw new Error("--host must be claude or codex");
			}
			host = value;
			index += 1;
			continue;
		}
		if (arg === "--work-id") {
			if (workId) throw new Error("--work-id may be supplied only once");
			workId = args[index + 1] || "";
			index += 1;
			continue;
		}
		if (arg === "--ticket-id") {
			if (ticketId) throw new Error("--ticket-id may be supplied only once");
			ticketId = args[index + 1] || "";
			index += 1;
			continue;
		}
		if (arg === "--reason") {
			if (reason) throw new Error("--reason may be supplied only once");
			reason = args[index + 1] || "";
			index += 1;
			continue;
		}
		throw new Error(`unknown argument: ${arg}`);
	}
	if (!host) throw new Error("--host is required");
	if (operation !== "create") {
		if (inputFile || !workId || !ticketId || (operation !== "resume" && !reason)) {
			throw new Error(
				`${operation} requires --work-id and --ticket-id${operation === "resume" ? "" : ", and --reason"}`,
			);
		}
		console.log(
			JSON.stringify(
				executeWorkMapLifecycle(operation, { workId, ticketId, reason }, {
					host,
					cwd: process.cwd(),
				}),
				null,
				2,
			),
		);
		return;
	}
	if (!inputFile || workId || ticketId || reason) throw new Error("create requires --input");
	const input = JSON.parse(readFileSync(resolve(inputFile), "utf8"));
	const result = executeWorkMapCreate(input, {
		mode: "real",
		host,
		cwd: process.cwd(),
	});
	console.log(JSON.stringify(result, null, 2));
}

async function trackerSync(args: string[]): Promise<void> {
	const operation = args.shift();
	if (operation !== "configure" && operation !== "preview" && operation !== "inspect" && operation !== "publish") throw new Error("sync requires configure, preview, inspect, or publish");
	let workId = "";
	let operationDigest = "";
	let stepId = "";
	let host = "";
	let inputFile = "";
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		const value = args[index + 1] ?? "";
		if (arg === "--work-id" && !workId) workId = value;
		else if (arg === "--operation-digest" && !operationDigest) operationDigest = value;
		else if (arg === "--step" && !stepId) stepId = value;
		else if (arg === "--input" && !inputFile) inputFile = value;
		else if (arg === "--host" && !host && (value === "claude" || value === "codex")) host = value;
		else throw new Error(`sync: invalid argument ${arg}`);
		index += 1;
	}
	if (!host) throw new Error("sync requires --host");
	if (operation === "configure") {
		if (!inputFile || workId || operationDigest || stepId) throw new Error("sync configure requires only --input and --host");
		const configuration = parseTrackerConfiguration(JSON.parse(readFileSync(resolve(inputFile), "utf8")));
		const readback = inspectTrackerConfiguration(configuration);
		if ("blockedReason" in readback && configuration.mode !== "off") throw new Error(readback.blockedReason);
		new TrackerConfigurationStore().write(configuration);
		console.log(JSON.stringify({ configuration, readback }, null, 2));
		return;
	}
	if (!workId || inputFile) throw new Error("sync operation requires --work-id");
	const runtime = new TrackerRuntime({ cwd: process.cwd() });
	if (operation === "preview") console.log(JSON.stringify(await runtime.preview(workId), null, 2));
	else if (operation === "inspect") console.log(JSON.stringify(await runtime.inspect(workId), null, 2));
	else {
		if (!operationDigest) throw new Error("sync publish requires --operation-digest");
		if (!stepId) throw new Error("sync publish requires --step");
		console.log(JSON.stringify(await runtime.publishStep({
			workId,
			operationDigest,
			stepId,
			// Native approval is the host/user authorization of this exact one-step command.
			approval: ({ stepId: approvedStep }) => {
				if (approvedStep !== stepId) throw new Error("native approval scope does not match the requested projection step");
			},
		}), null, 2));
	}
}

try {
	await main(process.argv.slice(2));
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
