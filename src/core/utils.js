'use strict'

const multihashes = require('multihashes')
const map = require('async/map')
const CID = require('cids')
const isIPFS = require('is-ipfs')

exports.OFFLINE_ERROR = 'This command must be run in online mode. Try running \'ipfs daemon\' first.'

/**
 * Break an ipfs-path down into it's root hash and an array of links.
 *
 * examples:
 *  b58Hash -> { root: 'b58Hash', links: [] }
 *  b58Hash/mercury/venus -> { root: 'b58Hash', links: ['mercury', 'venus']}
 *  /ipfs/b58Hash/links/by/name -> { root: 'b58Hash', links: ['links', 'by', 'name'] }
 *
 * @param  {String} ipfsPath An ipfs-path
 * @return {Object}            { root: base58 string, links: [string], ?err: Error }
 * @throws on an invalid @param ipfsPath
 */
exports.parseIpfsPath = function parseIpfsPath (ipfsPath) {
  const matched = ipfsPath.match(/^(?:\/ipfs\/)?([^/]+(?:\/[^/]+)*)\/?$/)
  const invalidPathErr = new Error('invalid ipfs ref path')
  if (!matched) {
    throw invalidPathErr
  }

  const [root, ...links] = matched[1].split('/')

  if (isIPFS.multihash(root)) {
    return {
      root: root,
      links: links
    }
  } else {
    throw invalidPathErr
  }
}

/**
 * Resolve various styles of an ipfs-path to the hash of the target node.
 * Follows links in the path.
 *
 * Accepts formats:
 *  - <base58 string>
 *  - <base58 string>/link/to/another/planet
 *  - /ipfs/<base58 string>
 *  - Buffers of the above
 *  - multihash Buffer
 *  - Arrays of the above
 *
 * @param  {IPFS}   ipfs       the IPFS node
 * @param  {Described above}   ipfsPaths A single or collection of ipfs-paths
 * @param  {Function} callback Node-style callback. res is Array<Buffer(hash)>
 * @return {void}
 */
exports.resolveIpfsPaths = function resolveIpfsPaths (ipfs, ipfsPaths, callback) {
  if (!Array.isArray(ipfsPaths)) {
    ipfsPaths = [ipfsPaths]
  }

  map(ipfsPaths, (path, cb) => {
    if (typeof path !== 'string') {
      try {
        multihashes.validate(path)
      } catch (err) {
        cb(err)
      }
      cb(null, path)
    }

    let parsedPath
    try {
      parsedPath = exports.parseIpfsPath(path)
    } catch(err) {
      return cb(err)
    }

    const rootHash = multihashes.fromB58String(parsedPath.root)
    const rootLinks = parsedPath.links
    if (!rootLinks.length) {
      return cb(null, rootHash)
    }

    ipfs.object.get(rootHash, follow.bind(null, rootLinks))

    // recursively follow named links to the target node
    function follow (links, err, obj) {
      if (err) {
        return cb(err)
      }
      if (!links.length) {
        // done tracing, obj is the target node
        return cb(null, obj.multihash)
      }

      const linkName = links[0]
      const nextObj = obj.links.find(link => link.name === linkName)
      if (!nextObj) {
        return cb(new Error(
          `no link named '${linkName}' under ${obj.multihash}`
        ))
      }

      ipfs.object.get(nextObj.multihash, follow.bind(null, links.slice(1)))
    }
  }, callback)
}
