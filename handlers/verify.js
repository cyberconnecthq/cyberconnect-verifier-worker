import { recoverTypedSignature_v4 as recoverTypedSignatureV4 } from 'eth-sig-util'
import { gatherResponse } from '../utils'
import { toChecksumAddress } from 'ethereumjs-util'
import { Octokit } from '@octokit/rest'

// github api info
const USER_AGENT = 'Cloudflare Worker'

// format request for twitter api
var requestHeaders = new Headers()
requestHeaders.append('Authorization', 'Bearer ' + TWITTER_BEARER)
var requestOptions = {
    method: 'GET',
    headers: requestHeaders,
    redirect: 'follow',
}
const init = {
    headers: {
        'content-type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        Vary: 'Origin',
    },
}

// regex for parsing tweet
const sigReg = new RegExp('(?<=sig:).*')

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
export async function handleVerify(request) {
    try {
        // get tweet handle and addr from url
        const { searchParams } = new URL(request.url)

        const handle = searchParams.get('handle')
        const addr = searchParams.get('addr')

        // get tweet data from twitter api
        const twitterURL = `https://api.twitter.com/2/tweets/search/recent?query=from:${handle}`
        requestOptions.headers.set('Origin', new URL(twitterURL).origin) // format for cors
        const twitterRes = await fetch(twitterURL, requestOptions)
        // parse the response from Twitter
        const twitterResponse = await gatherResponse(twitterRes)

        // if no tweet or author found, return error
        if (!twitterResponse.data) {
            return new Response('invalid handle', {
                ...init,
                status: 400,
                statusText: 'Invalid handle',
            })
        }

        // get tweet text and handle
        const tweets = twitterResponse.data

        // // parse sig from tweet
        const matched = tweets.find(tweet => {
            return !!tweet.text.match(sigReg)
        })

        if (!matched) {
            return new Response(null, {
                ...init,
                status: 400,
                statusText: 'Can not find the tweet',
            })
        }

        const tweetID = matched.id
        const matchedText = matched.text

        // parse sig from tweet
        const sig = matchedText.match(sigReg)[0].slice(0, 132)

        const msgParams = {
            domain: {
                name: 'CyberConnect Verifier',
                version: '1',
            },
            message: {
                contents: "I'm verifying my Twitter account on CyberConnect",
            },
            primaryType: 'Permit',
            types: {
                EIP712Domain: [
                    { name: 'name', type: 'string' },
                    { name: 'version', type: 'string' },
                ],
                Permit: [{ name: 'contents', type: 'string' }],
            },
        }

        const recoveredAddr = recoverTypedSignatureV4({
            data: msgParams,
            sig,
        })

        // if signer found is not the expected signer, alert client and dont update gist
        if (toChecksumAddress(recoveredAddr) !== toChecksumAddress(addr)) {
            return new Response(null, {
                ...init,
                status: 400,
                statusText: "Address doesn't match",
            })
        }

        // initialize response
        let response

        const fileName = 'verified.json'
        const githubPath = '/repos/cyberconnecthq/connect-list/contents/'

        const fileInfo = await fetch(
            'https://api.github.com' + githubPath + fileName,
            {
                headers: {
                    Authorization: 'token ' + GITHUB_AUTHENTICATION,
                    'User-Agent': USER_AGENT,
                },
            }
        )

        const fileJSON = await fileInfo.json()
        const sha = fileJSON.sha

        // Decode the String as json object
        var decodedSybilList = JSON.parse(atob(fileJSON.content))

        decodedSybilList[recoveredAddr] = {
            twitter: {
                timestamp: Date.now(),
                tweetID,
                handle,
            },
        }

        const stringData = JSON.stringify(decodedSybilList)
        const encodedData = btoa(stringData)

        const octokit = new Octokit({
            auth: GITHUB_AUTHENTICATION,
        })

        const updateResponse = await octokit.request(
            'PUT ' + githubPath + fileName,
            {
                owner: 'cyberconnect',
                repo: 'connect-list',
                path: fileName,
                message: 'Linking ' + recoveredAddr + ' to handle: ' + handle,
                sha,
                content: encodedData,
            }
        )

        if (updateResponse.status === 200) {
            // respond with handle if succesul update
            response = new Response(handle, {
                ...init,
                status: 200,
                statusText: 'Succesful verification',
            })
        } else {
            response = new Response(null, {
                ...init,
                status: 400,
                statusText: 'Error updating list.',
            })
        }

        return response
    } catch (e) {
        return new Response(null, {
            ...init,
            status: 400,
            statusText: 'Error:' + e,
        })
    }
}
