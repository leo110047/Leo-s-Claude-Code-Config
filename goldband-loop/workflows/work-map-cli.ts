#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	executeWorkMapCreate,
	executeWorkMapLifecycle,
} from "./work-map-runtime";

function main(args: string[]): void {
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

try {
	main(process.argv.slice(2));
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
