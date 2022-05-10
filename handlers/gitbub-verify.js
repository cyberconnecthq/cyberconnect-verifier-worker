import { githubVerify } from '@cyberlab/social-verifier'

/**
 * @param {*} request
 * Accpets gist_id=<gist id>
 * Accepts addr=<eth address> // just used to aler client of incorrect signer found
 */
export const handleGithubVerify = async request => {
    try {
        const { searchParams } = new URL(request.url)

        const gist_id = searchParams.get('gist_id')
        const addr = searchParams.get('addr')

        await githubVerify(addr, gist_id)

        response = new Response(JSON.stringify({ handle }), {
            ...init,
            status: 200,
            statusText: 'Succesful verification',
        })

        return response
    } catch (e) {
        console.log(e)
        return new Response(JSON.stringify({ errorText: e.message || e }), {
            ...init,
            status: 400,
            statusText: e,
        })
    }
}
