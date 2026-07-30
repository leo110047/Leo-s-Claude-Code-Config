#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { executeWorkMapCreate } from "./work-map-runtime";

function main(args: string[]): void {
	let inputFile = "";
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
		throw new Error(`unknown argument: ${arg}`);
	}
	if (!inputFile) throw new Error("--input is required");
	if (!host) throw new Error("--host is required");
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
