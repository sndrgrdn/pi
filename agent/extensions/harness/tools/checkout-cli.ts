import { CheckoutCache } from "./checkout.ts";

const repo = process.argv[2];
if (!repo) {
	console.error("Usage: checkout.sh <repo>");
	process.exitCode = 2;
} else {
	new CheckoutCache().checkout(repo)
		.then((path) => console.log(path))
		.catch((error: unknown) => {
			console.error(error instanceof Error ? error.message : String(error));
			process.exitCode = 1;
		});
}
