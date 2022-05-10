/**
 * @param {*} request
 * Accpets handle=<tweet handle>
 * Accepts addr=<eth address> // just used to aler client of incorrect signer found
 *
 * 1. fetch tweet data using handle
 * 2. construct signature data using handle from tweet
 * 3. recover signer of signature from tweet
 * 4. if signer is the expected address, update gist with address -> handle mapping
 */
export async function handleVerify() {
    return new Response(
        JSON.stringify({
            errorText: 'Please update @cyberlab/social-verifier package',
        }),
        {
            ...init,
            status: 400,
            statusText: 'Please update @cyberlab/social-verifier package',
        }
    )
}
