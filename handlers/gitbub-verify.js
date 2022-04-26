import { recoverTypedSignature_v4 as recoverTypedSignatureV4 } from 'eth-sig-util'
import { Octokit } from '@octokit/rest'
import { toChecksumAddress } from 'ethereumjs-util'

// github api info
const USER_AGENT = 'Cloudflare Worker'

const init = {
    headers: {
        'content-type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        Vary: 'Origin',
    },
}

// regex for parsing tweet
const sigReg = new RegExp('(?<=sig:).*')

const octokit = new Octokit({
    auth: GITHUB_AUTHENTICATION,
})

// sign message
const msgParams = username => {
    return {
        domain: {
            name: 'CyberConnect Verifier',
            version: '1',
        },
        message: {
            contents: `I'm verifying my Github account with username ${username}.`,
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
}

const getGistInfo = async gist_id => {
    if (!gist_id) {
        throw 'Invalid gist url'
    }

    const gistResponse = await octokit.request(`GET /gists/{gist_id}`, {
        gist_id: gist_id,
    })

    if (!gistResponse.data) {
        throw 'Invalid gist id'
    }

    const gistInfo = gistResponse.data
    const owner = gistInfo.owner

    if (!owner) {
        throw 'Gist does not have owner'
    }

    // parse username and user_id from gist
    const username = owner.login
    const user_id = owner.id

    // parse sig from gist
    const files = gistInfo.files

    if (!files) {
        throw 'Gist does not have files'
    }

    let matched = null

    for (const file in files) {
        if (files[file].content.match(sigReg)) {
            matched = files[file]
        }
    }

    if (!matched) {
        throw 'Can not find the signature in gist'
    }

    const sig = matched.content.match(sigReg)[0].slice(0, 132)

    return { username, user_id, sig }
}

const writeVerify = async ({ fileName, addr, username, gist_id, user_id }) => {
    // initialize response
    let response

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
        decodedList[addr] &&
        decodedList[addr].github &&
        decodedList[addr].github.username === username
    ) {
        return new Response(
            JSON.stringify({
                errorText: `The address already verified with the username ${username}`,
            }),
            {
                ...init,
                status: 400,
                statusText: `The address already verified with the username ${username}`,
            }
        )
    }

    decodedList[addr] = {
        ...(decodedList[addr] || {}),
        github: {
            timestamp: Date.now(),
            username,
            gist_id,
            user_id,
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
            message: 'Linking ' + addr + ' to github username: ' + username,
            sha,
            content: encodedData,
        }
    )

    if (updateResponse.status === 200) {
        // respond with handle if succesul update
        response = new Response(JSON.stringify({ username }), {
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
 * Accpets gist_id=<gist id>
 * Accepts addr=<eth address> // just used to aler client of incorrect signer found
 *
 * 1. fetch gist data using gist_id
 * 2. construct signature data from the gist
 * 3. recover signer from the signature
 * 4. if signer is the expected address, update gist with address -> username mapping
 */
export const handleGithubVerify = async request => {
    try {
        const { searchParams } = new URL(request.url)

        const gist_id = searchParams.get('gist_id')
        const addr = searchParams.get('addr')
        console.log(addr)

        const { username, user_id, sig } = await getGistInfo(gist_id)

        console.log(username)

        const recoveredAddr = recoverTypedSignatureV4({
            data: msgParams(username),
            sig,
        })

        // if signer found is not the expected signer, alert client and dont update gist
        if (toChecksumAddress(recoveredAddr) !== toChecksumAddress(addr)) {
            return new Response(
                JSON.stringify({ errorText: 'Address does not match' }),
                {
                    ...init,
                    status: 400,
                    statusText: "Address doesn't match",
                }
            )
        }

        const response = await writeVerify({
            fileName: 'verified.json',
            gist_id,
            username,
            addr: recoveredAddr,
            user_id,
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
