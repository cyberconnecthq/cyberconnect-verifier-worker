import { twitterVerify } from '@cyberlab/social-verifier'

/**
 * @param {*} request
 * Accpets handle=<tweet handle>
 * Accepts addr=<eth address> // just used to aler client of incorrect signer found
 */
export async function handleVerify(request) {
    try {
        // get tweet handle and addr from url
        const { searchParams } = new URL(request.url)

        const handle = searchParams.get('handle').trim()
        const addr = searchParams.get('addr')

        await twitterVerify(addr, handle)

        response = new Response(JSON.stringify({ handle }), {
            ...init,
            status: 200,
            statusText: 'Succesful verification',
        })

        return response
    } catch (e) {
        return new Response(JSON.stringify({ errorText: e }), {
            ...init,
            status: 400,
            statusText: e,
        })
    }
}
