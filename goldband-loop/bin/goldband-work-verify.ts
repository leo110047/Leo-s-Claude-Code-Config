#!/usr/bin/env bun

import {
	recordAnalysisArtifact,
	recordManualVerification,
	recordVerification,
} from "../lib/verification-receipt";

export function main(args = process.argv.slice(2)): number {
	const stage = args.shift();
	if (!stage || !["red", "green", "check", "manual", "analysis"].includes(stage)) {
		throw new Error("expected verification stage: red, green, check, manual, or analysis");
	}
	if (stage === "analysis") {
		let workId = "";
		let ticketId = "";
		let artifactPath = "";
		while (args.length > 0) {
			const flag = args.shift();
			const value = args.shift();
			if (!value) throw new Error(`${flag} requires a value`);
			if (flag === "--work-id") workId = value;
			else if (flag === "--ticket-id") ticketId = value;
			else if (flag === "--artifact") artifactPath = value;
			else throw new Error(`unknown analysis verification option: ${flag}`);
		}
		if (!workId || !ticketId || !artifactPath) {
			throw new Error(
				"analysis verification requires --work-id, --ticket-id, and --artifact",
			);
		}
		const artifact = recordAnalysisArtifact({
			workId,
			ticketId,
			artifactPath,
		});
		console.log(JSON.stringify(artifact, null, 2));
		return 0;
	}
	if (stage === "manual") {
		const steps: string[] = [];
		let observableResult = "";
		let artifactReference = "";
		while (args.length > 0) {
			const flag = args.shift();
			const value = args.shift();
			if (!value) throw new Error(`${flag} requires a value`);
			if (flag === "--step") steps.push(value);
			else if (flag === "--result") observableResult = value;
			else if (flag === "--artifact") artifactReference = value;
			else throw new Error(`unknown manual verification option: ${flag}`);
		}
		const receipt = recordManualVerification({
			steps,
			observableResult,
			artifactReference,
		});
		console.log(JSON.stringify(receipt, null, 2));
		return 0;
	}

	let seam: string | undefined;
	let expectedSignal: string | undefined;
	while (args[0] !== "--") {
		const flag = args.shift();
		const value = args.shift();
		if (!flag || !value) throw new Error(`${flag ?? "option"} requires a value`);
		if (flag === "--seam") seam = value;
		else if (flag === "--expect") expectedSignal = value;
		else throw new Error(`unknown verification option: ${flag}`);
	}
	args.shift();
	const receipt = recordVerification({
		stage: stage as "red" | "green" | "check",
		command: args,
		seam,
		expectedSignal,
	});
	console.log(JSON.stringify(receipt, null, 2));
	return 0;
}

if (import.meta.main) {
	try {
		process.exitCode = main();
	} catch (error) {
		console.error(
			`goldband-work-verify: ${error instanceof Error ? error.message : String(error)}`,
		);
		process.exitCode = 1;
	}
}
