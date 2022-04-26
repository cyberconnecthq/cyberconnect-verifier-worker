import { recoverTypedSignature_v4 as recoverTypedSignatureV4 } from 'eth-sig-util'
import { gatherResponse } from '../utils'
import { toChecksumAddress } from 'ethereumjs-util'
import { Octokit } from '@octokit/rest'
import { sign } from 'tweetnacl'
import bs58 from 'bs58'

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

// sign message
const msgParams = {
    domain: {
        name: 'CyberConnect Verifier',
        version: '1',
    },
    message: {
        contents: "I'm verifying my Twitter account.",
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

// get tweet data from twitter api
const getTweetInfo = async handle => {
    // get tweet data from twitter api
    const twitterURL = `https://api.twitter.com/2/tweets/search/recent?query=from:${handle}`
    requestOptions.headers.set('Origin', new URL(twitterURL).origin) // format for cors
    const twitterRes = await fetch(twitterURL, requestOptions)
    // parse the response from Twitter
    const twitterResponse = await gatherResponse(twitterRes)

    // if no tweet or author found, return error
    if (!twitterResponse.data) {
        throw 'Invalid handle'
    }

    // get tweet text and handle
    const tweets = twitterResponse.data

    // // parse sig from tweet
    const matched = tweets.find(tweet => {
        return !!tweet.text.match(sigReg)
    })

    if (!matched) {
        throw 'Can not find the tweet'
    }

    const tweetID = matched.id
    const matchedText = matched.text

    // parse sig from tweet
    const sig = matchedText.match(sigReg)[0].slice(0, 132)

    return { tweetID, sig }
}

const writeVerify = async ({ fileName, addr, handle, tweetID }) => {
    // initialize response
    let response

    const octokit = new Octokit({
        auth: GITHUB_AUTHENTICATION,
    })

    const githubPath = '/repos/cyberconnecthq/connect-list/contents/'

    const repoInfo = await fetch('https://api.github.com' + githubPath, {
        headers: {
            Authorization: 'token ' + GITHUB_AUTHENTICATION,
            'User-Agent': USER_AGENT,
            'cache-control': 'no-store',
        },
    })

    const repoJSON = await repoInfo.json()

    const verifyFile = repoJSON.find(file => {
        return file.name === fileName
    })

    const sha = verifyFile.sha

    const fileInfo = await octokit.request(
        'GET /repos/{owner}/{repo}/git/blobs/{file_sha}',
        {
            owner: 'cyberconnecthq',
            repo: 'connect-list',
            file_sha: sha,
        }
    )

    const fileJSON = fileInfo.data

    // // Decode the String as json object
    var decodedList = JSON.parse(atob(fileJSON.content))

    if (
        !!decodedList[addr] &&
        decodedList[addr].twitter &&
        decodedList[addr].twitter.handle === handle
    ) {
        return new Response(
            JSON.stringify({ errorText: 'Address already verified.' }),
            {
                ...init,
                status: 400,
                statusText: 'Address already verified.',
            }
        )
    }

    decodedList[addr] = {
        ...(decodedList[addr] || {}),
        twitter: {
            timestamp: Date.now(),
            tweetID,
            handle,
        },
    }

    const stringData = JSON.stringify(decodedList)

    const encodedData = btoa(stringData)

    const updateResponse = await octokit.request(
        'PUT ' + githubPath + fileName,
        {
            owner: 'cyberconnecthq',
            repo: 'connect-list',
            path: fileName,
            message: 'Linking ' + addr + ' to handle: ' + handle,
            sha,
            content: encodedData,
        }
    )

    if (updateResponse.status === 200) {
        // respond with handle if succesul update
        response = new Response(JSON.stringify({ handle }), {
            ...init,
            status: 200,
            statusText: 'Succesful verification',
        })
    } else {
        response = new Response(
            JSON.stringify({ errorText: 'Error updating list.' }),
            {
                ...init,
                status: 400,
                statusText: 'Error updating list.',
            }
        )
    }

    return response
}

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

        const handle = searchParams.get('handle').trim()
        const addr = searchParams.get('addr')

        const { tweetID, sig } = await getTweetInfo(handle)

        const recoveredAddr = recoverTypedSignatureV4({
            data: msgParams,
            sig,
        })

        // if signer found is not the expected signer, alert client and dont update gist
        if (toChecksumAddress(recoveredAddr) !== toChecksumAddress(addr)) {
            return new Response(
                JSON.stringify({ errorText: 'Signature verify failed' }),
                {
                    ...init,
                    status: 400,
                    statusText: "Address doesn't match",
                }
            )
        }

        const response = await writeVerify({
            fileName: 'verified.json',
            tweetID,
            handle,
            addr: recoveredAddr,
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

export async function handleVerifySolana(request) {
    try {
        // get tweet handle and addr from url
        const { searchParams } = new URL(request.url)

        const handle = searchParams.get('handle').trim()
        const addr = searchParams.get('addr')

        const { tweetID, sig } = await getTweetInfo(handle)

        const message = new TextEncoder().encode(JSON.stringify(msgParams))

        // if signer found is not the expected signer, alert client and dont update gist
        if (
            !sign.detached.verify(message, bs58.decode(sig), bs58.decode(addr))
        ) {
            return new Response(
                JSON.stringify({ errorText: 'Signature verify failed' }),
                {
                    ...init,
                    status: 400,
                    statusText: 'Signature verify failed',
                }
            )
        }

        const response = await writeVerify({
            fileName: 'verified-solana.json',
            tweetID,
            handle,
            addr,
        })

        return response
    } catch (e) {
        console.log(e)
        return new Response(JSON.stringify({ errorText: e }), {
            ...init,
            status: 400,
            statusText: e,
        })
    }
}
