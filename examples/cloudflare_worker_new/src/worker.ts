/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import {
	AuthClient,
	CacheClient,
	Configurations,
	CredentialProvider,
	ExpiresIn,
	GenerateAuthToken,
	ListCaches,
	TokenScopes,
  } from '@gomomento/sdk-web';
  import {InternalSuperUserPermissions} from '@gomomento/sdk-core/dist/src/internal/utils';
  import XMLHttpRequestPolyfill from 'xhr4sw';


export interface Env {
	MOMENTO_SESSION_TOKEN: string;
	MOMENTO_BASE_ENDPOINT: string;
}
  
  async function momentoExample(sessionToken: string, baseEndpoint: string): Promise<string> {

	const controlEndpoint = `control.${baseEndpoint}`;
	const cacheEndpoint = `cache.${baseEndpoint}`;
	const httpEndpoint = `api.cache.${baseEndpoint}`;
	// Here we construct an auth client, which is where the token APIs are exposed
	const authClient = new AuthClient({
	  credentialProvider: CredentialProvider.fromString({
		authToken: sessionToken,
		controlEndpoint: controlEndpoint,
		cacheEndpoint: cacheEndpoint,
	  }),
	});
  
	// Here we generate a temporary superuser token that can be used to list caches in the region
	const wizardTokenResponse = await authClient.generateAuthToken(
	  new InternalSuperUserPermissions(),
	  ExpiresIn.seconds(30)
	);
	let wizardApiToken;
	if (wizardTokenResponse instanceof GenerateAuthToken.Success) {
	  wizardApiToken = wizardTokenResponse.authToken;
	} else {
	  throw new Error(`A problem occurred when generating auth token: ${wizardTokenResponse.toString()}`);
	}
  
	// Now we create a cache client for interacting with the cache APIs
	const cacheClient = new CacheClient({
	  configuration: Configurations.Browser.latest(),
	  credentialProvider: CredentialProvider.fromString({authToken: wizardApiToken}),
	  defaultTtlSeconds: 60,
	});
  
	// Get the list of existing caches
	const listCachesResponse = await cacheClient.listCaches();
	let caches;
	if (listCachesResponse instanceof ListCaches.Success) {
	  caches = listCachesResponse.getCaches();
	} else {
	  throw new Error(`A problem occurred when listing caches: ${listCachesResponse.toString()}`);
	}
  
	let response = `Found the following caches:\n${caches.map(c => c.getName()).join('\n')}`;
	console.log(`${response}`);
  
	if (caches && caches.length != 0) {
		// arbitrarily selecting the first cache:
		const chosenCache = caches[0].getName();
	
		// Now we create a more restricted token that can be used in the user's cloudflare worker environment
		const workerTokenResponse = await authClient.generateAuthToken(
		TokenScopes.cacheReadWrite(chosenCache),
		ExpiresIn.never()
		);
	
		let workerApiToken;
		if (workerTokenResponse instanceof GenerateAuthToken.Success) {
		workerApiToken = workerTokenResponse.authToken;
		} else {
		throw new Error(`A problem occurred when generating auth token: ${workerTokenResponse.toString()}`);
		}
	
		// This is just a sanity check that the new token works properly
		await verifyWorkerApiToken(workerApiToken, httpEndpoint, chosenCache);
		// And now we're all done, and just need to store these values as secrets/env vars!
		response += `\nIntegration complete! Here are the three required env vars:
		
MOMENTO_AUTH_TOKEN=${workerApiToken}
MOMENTO_HTTP_ENDPOINT=${httpEndpoint}
MOMENTO_CACHE=${chosenCache}
			
		`;
    } else {
		response += '\nNo caches found.';
	}
	return response;

  }
  
  async function verifyWorkerApiToken(workerApiToken: string, httpEndpoint: string, cacheName: string) {
	const testKey = 'testkey';
	const testValue = 'testvalue';
  
	// set a value in the cache:
	const setResp = await fetch(
	  `https://${httpEndpoint}/cache/${cacheName}?key=${testKey}&token=${workerApiToken}&ttl_seconds=10`,
	  {
		method: 'PUT',
		body: testValue,
	  }
	);
  
	if (setResp.status < 300) {
	  console.log(`successfully set ${testKey} into cache`);
	} else {
	  throw new Error(
		`failed to set item into cache message: ${setResp.statusText} status: ${setResp.status} cache: ${cacheName}`
	  );
	}
  
	const getResp = await fetch(`https://${httpEndpoint}/cache/${cacheName}?key=${testKey}&token=${workerApiToken}`);
	if (getResp.status < 300) {
	  console.log(`successfully retrieved ${testKey} from cache`);
	} else {
	  throw new Error(`failed to retrieve item from cache: ${cacheName}`);
	}
  
	const value = await getResp.text();
	if (value === testValue) {
	  console.log('Retrieved expected value from cache!');
	} else {
	  throw new Error(`Retrieved unexpected value '${value}' from cache!`);
	}
  }
  
export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		Object.defineProperty(self, 'XMLHttpRequest', {
			configurable: false,
			enumerable: true,
			writable: false,
			value: XMLHttpRequestPolyfill
		});
		// The session token will come from auth0
		const sessionToken = env.MOMENTO_SESSION_TOKEN;
		if (!sessionToken) {
		throw new Error('Missing required env var MOMENTO_SESSION_TOKEN');
		}
	
		// These DNS names will be based on which region the user selects
		const baseEndpoint = env.MOMENTO_BASE_ENDPOINT;
		if (!baseEndpoint) {
			throw new Error('Missing required env var MOMENTO_BASE_ENDPOINT');
		}

		const resp = await momentoExample(sessionToken, baseEndpoint);
		return new Response(resp);
	
    },
};
