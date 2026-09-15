/*eslint-disable block-scoped-var, id-length, no-control-regex, no-magic-numbers, no-mixed-operators, no-prototype-builtins, no-redeclare, no-shadow, no-var, sort-vars, default-case, jsdoc/require-param*/
import $protobuf from "protobufjs/minimal.js";

// Common aliases
const $Reader = $protobuf.Reader, $Writer = $protobuf.Writer, $util = $protobuf.util;
const $Object = $util.global.Object, $undefined = $util.global.undefined, $Error = $util.global.Error, $RangeError = $util.global.RangeError;

// Exported root namespace
const $root = $protobuf.roots["default"] || ($protobuf.roots["default"] = {});

export const outreach = $root.outreach = (() => {

    /**
     * Namespace outreach.
     * @exports outreach
     * @namespace
     */
    const outreach = {};

    outreach.postlist = (function() {

        /**
         * Namespace postlist.
         * @memberof outreach
         * @namespace
         */
        const postlist = {};

        postlist.v1 = (function() {

            /**
             * Namespace v1.
             * @memberof outreach.postlist
             * @namespace
             */
            const v1 = {};

            v1.Creator = (function() {

                /**
                 * Properties of a Creator.
                 * @typedef {Object} outreach.postlist.v1.Creator.$Properties
                 * @property {string|null} [id] Creator id
                 * @property {string|null} [name] Creator name
                 * @property {string|null} [handle] Creator handle
                 * @property {string|null} [avatarUrl] Creator avatarUrl
                 * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
                 */

                /**
                 * Properties of a Creator.
                 * @memberof outreach.postlist.v1
                 * @interface ICreator
                 * @augments outreach.postlist.v1.Creator.$Properties
                 * @deprecated Use outreach.postlist.v1.Creator.$Properties instead.
                 */

                /**
                 * Shape of a Creator.
                 * @typedef {outreach.postlist.v1.Creator.$Properties} outreach.postlist.v1.Creator.$Shape
                 */

                /**
                 * Constructs a new Creator.
                 * @memberof outreach.postlist.v1
                 * @classdesc Represents a Creator.
                 * @constructor
                 * @param {outreach.postlist.v1.Creator.$Properties=} [properties] Properties to set
                 * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
                 */
                const Creator = function (properties) {
                    if (properties)
                        for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                            if (properties[keys[i]] != null && keys[i] !== "__proto__")
                                this[keys[i]] = properties[keys[i]];
                };

                /**
                 * Creator id.
                 * @member {string|null|undefined} id
                 * @memberof outreach.postlist.v1.Creator
                 * @instance
                 */
                Creator.prototype.id = null;

                /**
                 * Creator name.
                 * @member {string|null|undefined} name
                 * @memberof outreach.postlist.v1.Creator
                 * @instance
                 */
                Creator.prototype.name = null;

                /**
                 * Creator handle.
                 * @member {string|null|undefined} handle
                 * @memberof outreach.postlist.v1.Creator
                 * @instance
                 */
                Creator.prototype.handle = null;

                /**
                 * Creator avatarUrl.
                 * @member {string|null|undefined} avatarUrl
                 * @memberof outreach.postlist.v1.Creator
                 * @instance
                 */
                Creator.prototype.avatarUrl = null;

                // OneOf field names bound to virtual getters and setters
                let $oneOfFields;

                // Virtual OneOf for proto3 optional field
                $Object.defineProperty(Creator.prototype, "_id", {
                    get: $util.oneOfGetter($oneOfFields = ["id"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                $Object.defineProperty(Creator.prototype, "_name", {
                    get: $util.oneOfGetter($oneOfFields = ["name"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                $Object.defineProperty(Creator.prototype, "_handle", {
                    get: $util.oneOfGetter($oneOfFields = ["handle"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                $Object.defineProperty(Creator.prototype, "_avatarUrl", {
                    get: $util.oneOfGetter($oneOfFields = ["avatarUrl"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                /**
                 * Encodes the specified Creator message. Does not implicitly {@link outreach.postlist.v1.Creator.verify|verify} messages.
                 * @function encode
                 * @memberof outreach.postlist.v1.Creator
                 * @static
                 * @param {outreach.postlist.v1.Creator.$Properties} message Creator message or plain object to encode
                 * @param {$protobuf.Writer} [writer] Writer to encode to
                 * @returns {$protobuf.Writer} Writer
                 */
                Creator.encode = function (message, writer, _depth) {
                    if (!writer)
                        writer = $Writer.create();
                    if (_depth === $undefined)
                        _depth = 0;
                    if (_depth > $util.recursionLimit)
                        throw $Error("max depth exceeded");
                    if (message.id != null && $Object.hasOwnProperty.call(message, "id"))
                        writer.uint32(/* id 1, wireType 2 =*/10).string(message.id);
                    if (message.name != null && $Object.hasOwnProperty.call(message, "name"))
                        writer.uint32(/* id 2, wireType 2 =*/18).string(message.name);
                    if (message.handle != null && $Object.hasOwnProperty.call(message, "handle"))
                        writer.uint32(/* id 3, wireType 2 =*/26).string(message.handle);
                    if (message.avatarUrl != null && $Object.hasOwnProperty.call(message, "avatarUrl"))
                        writer.uint32(/* id 4, wireType 2 =*/34).string(message.avatarUrl);
                    if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                        for (let i = 0; i < message.$unknowns.length; ++i)
                            writer.raw(message.$unknowns[i]);
                    return writer;
                };

                /**
                 * Decodes a Creator message from the specified reader or buffer.
                 * @function decode
                 * @memberof outreach.postlist.v1.Creator
                 * @static
                 * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                 * @param {number} [length] Message length if known beforehand
                 * @returns {outreach.postlist.v1.Creator & outreach.postlist.v1.Creator.$Shape} Creator
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                Creator.decode = function (reader, length, _end, _depth, _target) {
                    if (!(reader instanceof $Reader))
                        reader = $Reader.create(reader);
                    if (_depth === $undefined)
                        _depth = 0;
                    if (_depth > $Reader.recursionLimit)
                        throw $Error("max depth exceeded");
                    let end, message;
                    if (length === $undefined)
                        end = reader.len;
                    else {
                        end = reader.pos + length;
                        if (end > reader.len)
                            throw $RangeError("index out of range");
                        length = reader.len;
                        reader.len = end;
                    }
                    message = _target || new $root.outreach.postlist.v1.Creator();
                    while (reader.pos < end) {
                        let start = reader.pos;
                        let tag = reader.tag();
                        if (tag === _end) {
                            _end = $undefined;
                            break;
                        }
                        let wireType = tag & 7;
                        switch (tag >>>= 3) {
                        case 1: {
                                if (wireType !== 2)
                                    break;
                                message.id = reader.stringVerify();
                                message._id = "id";
                                continue;
                            }
                        case 2: {
                                if (wireType !== 2)
                                    break;
                                message.name = reader.stringVerify();
                                message._name = "name";
                                continue;
                            }
                        case 3: {
                                if (wireType !== 2)
                                    break;
                                message.handle = reader.stringVerify();
                                message._handle = "handle";
                                continue;
                            }
                        case 4: {
                                if (wireType !== 2)
                                    break;
                                message.avatarUrl = reader.stringVerify();
                                message._avatarUrl = "avatarUrl";
                                continue;
                            }
                        }
                        reader.skipType(wireType, _depth, tag);
                        if (!reader.discardUnknown) {
                            $util.makeProp(message, "$unknowns", false);
                            (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                        }
                    }
                    if (length !== $undefined) {
                        if (reader.pos !== end)
                            throw $RangeError("index out of range");
                        reader.len = length;
                    }
                    if (_end !== $undefined)
                        throw $Error("missing end group");
                    return message;
                };

                /**
                 * Gets the type url for Creator
                 * @function getTypeUrl
                 * @memberof outreach.postlist.v1.Creator
                 * @static
                 * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
                 * @returns {string} The type url
                 */
                Creator.getTypeUrl = function(prefix) {
                    if (prefix === $undefined)
                        prefix = "type.googleapis.com";
                    return prefix + "/outreach.postlist.v1.Creator";
                };

                return Creator;
            })();

            v1.Snapshot = (function() {

                /**
                 * Properties of a Snapshot.
                 * @typedef {Object} outreach.postlist.v1.Snapshot.$Properties
                 * @property {string|null} [id] Snapshot id
                 * @property {number|Long|null} [viewsCount] Snapshot viewsCount
                 * @property {number|Long|null} [recordedAtMs] Snapshot recordedAtMs
                 * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
                 */

                /**
                 * Properties of a Snapshot.
                 * @memberof outreach.postlist.v1
                 * @interface ISnapshot
                 * @augments outreach.postlist.v1.Snapshot.$Properties
                 * @deprecated Use outreach.postlist.v1.Snapshot.$Properties instead.
                 */

                /**
                 * Shape of a Snapshot.
                 * @typedef {outreach.postlist.v1.Snapshot.$Properties} outreach.postlist.v1.Snapshot.$Shape
                 */

                /**
                 * Constructs a new Snapshot.
                 * @memberof outreach.postlist.v1
                 * @classdesc Represents a Snapshot.
                 * @constructor
                 * @param {outreach.postlist.v1.Snapshot.$Properties=} [properties] Properties to set
                 * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
                 */
                const Snapshot = function (properties) {
                    if (properties)
                        for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                            if (properties[keys[i]] != null && keys[i] !== "__proto__")
                                this[keys[i]] = properties[keys[i]];
                };

                /**
                 * Snapshot id.
                 * @member {string|null|undefined} id
                 * @memberof outreach.postlist.v1.Snapshot
                 * @instance
                 */
                Snapshot.prototype.id = null;

                /**
                 * Snapshot viewsCount.
                 * @member {number|Long|null|undefined} viewsCount
                 * @memberof outreach.postlist.v1.Snapshot
                 * @instance
                 */
                Snapshot.prototype.viewsCount = null;

                /**
                 * Snapshot recordedAtMs.
                 * @member {number|Long|null|undefined} recordedAtMs
                 * @memberof outreach.postlist.v1.Snapshot
                 * @instance
                 */
                Snapshot.prototype.recordedAtMs = null;

                // OneOf field names bound to virtual getters and setters
                let $oneOfFields;

                // Virtual OneOf for proto3 optional field
                $Object.defineProperty(Snapshot.prototype, "_id", {
                    get: $util.oneOfGetter($oneOfFields = ["id"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                $Object.defineProperty(Snapshot.prototype, "_viewsCount", {
                    get: $util.oneOfGetter($oneOfFields = ["viewsCount"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                $Object.defineProperty(Snapshot.prototype, "_recordedAtMs", {
                    get: $util.oneOfGetter($oneOfFields = ["recordedAtMs"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                /**
                 * Encodes the specified Snapshot message. Does not implicitly {@link outreach.postlist.v1.Snapshot.verify|verify} messages.
                 * @function encode
                 * @memberof outreach.postlist.v1.Snapshot
                 * @static
                 * @param {outreach.postlist.v1.Snapshot.$Properties} message Snapshot message or plain object to encode
                 * @param {$protobuf.Writer} [writer] Writer to encode to
                 * @returns {$protobuf.Writer} Writer
                 */
                Snapshot.encode = function (message, writer, _depth) {
                    if (!writer)
                        writer = $Writer.create();
                    if (_depth === $undefined)
                        _depth = 0;
                    if (_depth > $util.recursionLimit)
                        throw $Error("max depth exceeded");
                    if (message.id != null && $Object.hasOwnProperty.call(message, "id"))
                        writer.uint32(/* id 1, wireType 2 =*/10).string(message.id);
                    if (message.viewsCount != null && $Object.hasOwnProperty.call(message, "viewsCount"))
                        writer.uint32(/* id 2, wireType 0 =*/16).int64(message.viewsCount);
                    if (message.recordedAtMs != null && $Object.hasOwnProperty.call(message, "recordedAtMs"))
                        writer.uint32(/* id 3, wireType 0 =*/24).int64(message.recordedAtMs);
                    if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                        for (let i = 0; i < message.$unknowns.length; ++i)
                            writer.raw(message.$unknowns[i]);
                    return writer;
                };

                /**
                 * Decodes a Snapshot message from the specified reader or buffer.
                 * @function decode
                 * @memberof outreach.postlist.v1.Snapshot
                 * @static
                 * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                 * @param {number} [length] Message length if known beforehand
                 * @returns {outreach.postlist.v1.Snapshot & outreach.postlist.v1.Snapshot.$Shape} Snapshot
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                Snapshot.decode = function (reader, length, _end, _depth, _target) {
                    if (!(reader instanceof $Reader))
                        reader = $Reader.create(reader);
                    if (_depth === $undefined)
                        _depth = 0;
                    if (_depth > $Reader.recursionLimit)
                        throw $Error("max depth exceeded");
                    let end, message;
                    if (length === $undefined)
                        end = reader.len;
                    else {
                        end = reader.pos + length;
                        if (end > reader.len)
                            throw $RangeError("index out of range");
                        length = reader.len;
                        reader.len = end;
                    }
                    message = _target || new $root.outreach.postlist.v1.Snapshot();
                    while (reader.pos < end) {
                        let start = reader.pos;
                        let tag = reader.tag();
                        if (tag === _end) {
                            _end = $undefined;
                            break;
                        }
                        let wireType = tag & 7;
                        switch (tag >>>= 3) {
                        case 1: {
                                if (wireType !== 2)
                                    break;
                                message.id = reader.stringVerify();
                                message._id = "id";
                                continue;
                            }
                        case 2: {
                                if (wireType !== 0)
                                    break;
                                message.viewsCount = reader.int64();
                                message._viewsCount = "viewsCount";
                                continue;
                            }
                        case 3: {
                                if (wireType !== 0)
                                    break;
                                message.recordedAtMs = reader.int64();
                                message._recordedAtMs = "recordedAtMs";
                                continue;
                            }
                        }
                        reader.skipType(wireType, _depth, tag);
                        if (!reader.discardUnknown) {
                            $util.makeProp(message, "$unknowns", false);
                            (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                        }
                    }
                    if (length !== $undefined) {
                        if (reader.pos !== end)
                            throw $RangeError("index out of range");
                        reader.len = length;
                    }
                    if (_end !== $undefined)
                        throw $Error("missing end group");
                    return message;
                };

                /**
                 * Gets the type url for Snapshot
                 * @function getTypeUrl
                 * @memberof outreach.postlist.v1.Snapshot
                 * @static
                 * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
                 * @returns {string} The type url
                 */
                Snapshot.getTypeUrl = function(prefix) {
                    if (prefix === $undefined)
                        prefix = "type.googleapis.com";
                    return prefix + "/outreach.postlist.v1.Snapshot";
                };

                return Snapshot;
            })();

            v1.ComplianceFlag = (function() {

                /**
                 * Properties of a ComplianceFlag.
                 * @typedef {Object} outreach.postlist.v1.ComplianceFlag.$Properties
                 * @property {string|null} [code] ComplianceFlag code
                 * @property {string|null} [severity] ComplianceFlag severity
                 * @property {string|null} [message] ComplianceFlag message
                 * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
                 */

                /**
                 * Properties of a ComplianceFlag.
                 * @memberof outreach.postlist.v1
                 * @interface IComplianceFlag
                 * @augments outreach.postlist.v1.ComplianceFlag.$Properties
                 * @deprecated Use outreach.postlist.v1.ComplianceFlag.$Properties instead.
                 */

                /**
                 * Shape of a ComplianceFlag.
                 * @typedef {outreach.postlist.v1.ComplianceFlag.$Properties} outreach.postlist.v1.ComplianceFlag.$Shape
                 */

                /**
                 * Constructs a new ComplianceFlag.
                 * @memberof outreach.postlist.v1
                 * @classdesc Represents a ComplianceFlag.
                 * @constructor
                 * @param {outreach.postlist.v1.ComplianceFlag.$Properties=} [properties] Properties to set
                 * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
                 */
                const ComplianceFlag = function (properties) {
                    if (properties)
                        for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                            if (properties[keys[i]] != null && keys[i] !== "__proto__")
                                this[keys[i]] = properties[keys[i]];
                };

                /**
                 * ComplianceFlag code.
                 * @member {string|null|undefined} code
                 * @memberof outreach.postlist.v1.ComplianceFlag
                 * @instance
                 */
                ComplianceFlag.prototype.code = null;

                /**
                 * ComplianceFlag severity.
                 * @member {string|null|undefined} severity
                 * @memberof outreach.postlist.v1.ComplianceFlag
                 * @instance
                 */
                ComplianceFlag.prototype.severity = null;

                /**
                 * ComplianceFlag message.
                 * @member {string|null|undefined} message
                 * @memberof outreach.postlist.v1.ComplianceFlag
                 * @instance
                 */
                ComplianceFlag.prototype.message = null;

                // OneOf field names bound to virtual getters and setters
                let $oneOfFields;

                // Virtual OneOf for proto3 optional field
                $Object.defineProperty(ComplianceFlag.prototype, "_code", {
                    get: $util.oneOfGetter($oneOfFields = ["code"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                $Object.defineProperty(ComplianceFlag.prototype, "_severity", {
                    get: $util.oneOfGetter($oneOfFields = ["severity"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                $Object.defineProperty(ComplianceFlag.prototype, "_message", {
                    get: $util.oneOfGetter($oneOfFields = ["message"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                /**
                 * Encodes the specified ComplianceFlag message. Does not implicitly {@link outreach.postlist.v1.ComplianceFlag.verify|verify} messages.
                 * @function encode
                 * @memberof outreach.postlist.v1.ComplianceFlag
                 * @static
                 * @param {outreach.postlist.v1.ComplianceFlag.$Properties} message ComplianceFlag message or plain object to encode
                 * @param {$protobuf.Writer} [writer] Writer to encode to
                 * @returns {$protobuf.Writer} Writer
                 */
                ComplianceFlag.encode = function (message, writer, _depth) {
                    if (!writer)
                        writer = $Writer.create();
                    if (_depth === $undefined)
                        _depth = 0;
                    if (_depth > $util.recursionLimit)
                        throw $Error("max depth exceeded");
                    if (message.code != null && $Object.hasOwnProperty.call(message, "code"))
                        writer.uint32(/* id 1, wireType 2 =*/10).string(message.code);
                    if (message.severity != null && $Object.hasOwnProperty.call(message, "severity"))
                        writer.uint32(/* id 2, wireType 2 =*/18).string(message.severity);
                    if (message.message != null && $Object.hasOwnProperty.call(message, "message"))
                        writer.uint32(/* id 3, wireType 2 =*/26).string(message.message);
                    if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                        for (let i = 0; i < message.$unknowns.length; ++i)
                            writer.raw(message.$unknowns[i]);
                    return writer;
                };

                /**
                 * Decodes a ComplianceFlag message from the specified reader or buffer.
                 * @function decode
                 * @memberof outreach.postlist.v1.ComplianceFlag
                 * @static
                 * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                 * @param {number} [length] Message length if known beforehand
                 * @returns {outreach.postlist.v1.ComplianceFlag & outreach.postlist.v1.ComplianceFlag.$Shape} ComplianceFlag
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                ComplianceFlag.decode = function (reader, length, _end, _depth, _target) {
                    if (!(reader instanceof $Reader))
                        reader = $Reader.create(reader);
                    if (_depth === $undefined)
                        _depth = 0;
                    if (_depth > $Reader.recursionLimit)
                        throw $Error("max depth exceeded");
                    let end, message;
                    if (length === $undefined)
                        end = reader.len;
                    else {
                        end = reader.pos + length;
                        if (end > reader.len)
                            throw $RangeError("index out of range");
                        length = reader.len;
                        reader.len = end;
                    }
                    message = _target || new $root.outreach.postlist.v1.ComplianceFlag();
                    while (reader.pos < end) {
                        let start = reader.pos;
                        let tag = reader.tag();
                        if (tag === _end) {
                            _end = $undefined;
                            break;
                        }
                        let wireType = tag & 7;
                        switch (tag >>>= 3) {
                        case 1: {
                                if (wireType !== 2)
                                    break;
                                message.code = reader.stringVerify();
                                message._code = "code";
                                continue;
                            }
                        case 2: {
                                if (wireType !== 2)
                                    break;
                                message.severity = reader.stringVerify();
                                message._severity = "severity";
                                continue;
                            }
                        case 3: {
                                if (wireType !== 2)
                                    break;
                                message.message = reader.stringVerify();
                                message._message = "message";
                                continue;
                            }
                        }
                        reader.skipType(wireType, _depth, tag);
                        if (!reader.discardUnknown) {
                            $util.makeProp(message, "$unknowns", false);
                            (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                        }
                    }
                    if (length !== $undefined) {
                        if (reader.pos !== end)
                            throw $RangeError("index out of range");
                        reader.len = length;
                    }
                    if (_end !== $undefined)
                        throw $Error("missing end group");
                    return message;
                };

                /**
                 * Gets the type url for ComplianceFlag
                 * @function getTypeUrl
                 * @memberof outreach.postlist.v1.ComplianceFlag
                 * @static
                 * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
                 * @returns {string} The type url
                 */
                ComplianceFlag.getTypeUrl = function(prefix) {
                    if (prefix === $undefined)
                        prefix = "type.googleapis.com";
                    return prefix + "/outreach.postlist.v1.ComplianceFlag";
                };

                return ComplianceFlag;
            })();

            v1.MetricProvenance = (function() {

                /**
                 * Properties of a MetricProvenance.
                 * @typedef {Object} outreach.postlist.v1.MetricProvenance.$Properties
                 * @property {Array.<string>|null} [measured] MetricProvenance measured
                 * @property {string|null} [lastFetchReason] MetricProvenance lastFetchReason
                 * @property {string|null} [lastFetchAt] MetricProvenance lastFetchAt
                 * @property {string|null} [lastFetchVia] MetricProvenance lastFetchVia
                 * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
                 */

                /**
                 * Properties of a MetricProvenance.
                 * @memberof outreach.postlist.v1
                 * @interface IMetricProvenance
                 * @augments outreach.postlist.v1.MetricProvenance.$Properties
                 * @deprecated Use outreach.postlist.v1.MetricProvenance.$Properties instead.
                 */

                /**
                 * Shape of a MetricProvenance.
                 * @typedef {outreach.postlist.v1.MetricProvenance.$Properties} outreach.postlist.v1.MetricProvenance.$Shape
                 */

                /**
                 * Constructs a new MetricProvenance.
                 * @memberof outreach.postlist.v1
                 * @classdesc Represents a MetricProvenance.
                 * @constructor
                 * @param {outreach.postlist.v1.MetricProvenance.$Properties=} [properties] Properties to set
                 * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
                 */
                const MetricProvenance = function (properties) {
                    this.measured = [];
                    if (properties)
                        for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                            if (properties[keys[i]] != null && keys[i] !== "__proto__")
                                this[keys[i]] = properties[keys[i]];
                };

                /**
                 * MetricProvenance measured.
                 * @member {Array.<string>} measured
                 * @memberof outreach.postlist.v1.MetricProvenance
                 * @instance
                 */
                MetricProvenance.prototype.measured = $util.emptyArray;

                /**
                 * MetricProvenance lastFetchReason.
                 * @member {string|null|undefined} lastFetchReason
                 * @memberof outreach.postlist.v1.MetricProvenance
                 * @instance
                 */
                MetricProvenance.prototype.lastFetchReason = null;

                /**
                 * MetricProvenance lastFetchAt.
                 * @member {string|null|undefined} lastFetchAt
                 * @memberof outreach.postlist.v1.MetricProvenance
                 * @instance
                 */
                MetricProvenance.prototype.lastFetchAt = null;

                /**
                 * MetricProvenance lastFetchVia.
                 * @member {string|null|undefined} lastFetchVia
                 * @memberof outreach.postlist.v1.MetricProvenance
                 * @instance
                 */
                MetricProvenance.prototype.lastFetchVia = null;

                // OneOf field names bound to virtual getters and setters
                let $oneOfFields;

                // Virtual OneOf for proto3 optional field
                $Object.defineProperty(MetricProvenance.prototype, "_lastFetchReason", {
                    get: $util.oneOfGetter($oneOfFields = ["lastFetchReason"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                $Object.defineProperty(MetricProvenance.prototype, "_lastFetchAt", {
                    get: $util.oneOfGetter($oneOfFields = ["lastFetchAt"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                $Object.defineProperty(MetricProvenance.prototype, "_lastFetchVia", {
                    get: $util.oneOfGetter($oneOfFields = ["lastFetchVia"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                /**
                 * Encodes the specified MetricProvenance message. Does not implicitly {@link outreach.postlist.v1.MetricProvenance.verify|verify} messages.
                 * @function encode
                 * @memberof outreach.postlist.v1.MetricProvenance
                 * @static
                 * @param {outreach.postlist.v1.MetricProvenance.$Properties} message MetricProvenance message or plain object to encode
                 * @param {$protobuf.Writer} [writer] Writer to encode to
                 * @returns {$protobuf.Writer} Writer
                 */
                MetricProvenance.encode = function (message, writer, _depth) {
                    if (!writer)
                        writer = $Writer.create();
                    if (_depth === $undefined)
                        _depth = 0;
                    if (_depth > $util.recursionLimit)
                        throw $Error("max depth exceeded");
                    if (message.measured != null && message.measured.length)
                        for (let i = 0; i < message.measured.length; ++i)
                            writer.uint32(/* id 1, wireType 2 =*/10).string(message.measured[i]);
                    if (message.lastFetchReason != null && $Object.hasOwnProperty.call(message, "lastFetchReason"))
                        writer.uint32(/* id 2, wireType 2 =*/18).string(message.lastFetchReason);
                    if (message.lastFetchAt != null && $Object.hasOwnProperty.call(message, "lastFetchAt"))
                        writer.uint32(/* id 3, wireType 2 =*/26).string(message.lastFetchAt);
                    if (message.lastFetchVia != null && $Object.hasOwnProperty.call(message, "lastFetchVia"))
                        writer.uint32(/* id 4, wireType 2 =*/34).string(message.lastFetchVia);
                    if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                        for (let i = 0; i < message.$unknowns.length; ++i)
                            writer.raw(message.$unknowns[i]);
                    return writer;
                };

                /**
                 * Decodes a MetricProvenance message from the specified reader or buffer.
                 * @function decode
                 * @memberof outreach.postlist.v1.MetricProvenance
                 * @static
                 * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                 * @param {number} [length] Message length if known beforehand
                 * @returns {outreach.postlist.v1.MetricProvenance & outreach.postlist.v1.MetricProvenance.$Shape} MetricProvenance
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                MetricProvenance.decode = function (reader, length, _end, _depth, _target) {
                    if (!(reader instanceof $Reader))
                        reader = $Reader.create(reader);
                    if (_depth === $undefined)
                        _depth = 0;
                    if (_depth > $Reader.recursionLimit)
                        throw $Error("max depth exceeded");
                    let end, message;
                    if (length === $undefined)
                        end = reader.len;
                    else {
                        end = reader.pos + length;
                        if (end > reader.len)
                            throw $RangeError("index out of range");
                        length = reader.len;
                        reader.len = end;
                    }
                    message = _target || new $root.outreach.postlist.v1.MetricProvenance();
                    while (reader.pos < end) {
                        let start = reader.pos;
                        let tag = reader.tag();
                        if (tag === _end) {
                            _end = $undefined;
                            break;
                        }
                        let wireType = tag & 7;
                        switch (tag >>>= 3) {
                        case 1: {
                                if (wireType !== 2)
                                    break;
                                if (!(message.measured && message.measured.length))
                                    message.measured = [];
                                message.measured.push(reader.stringVerify());
                                continue;
                            }
                        case 2: {
                                if (wireType !== 2)
                                    break;
                                message.lastFetchReason = reader.stringVerify();
                                message._lastFetchReason = "lastFetchReason";
                                continue;
                            }
                        case 3: {
                                if (wireType !== 2)
                                    break;
                                message.lastFetchAt = reader.stringVerify();
                                message._lastFetchAt = "lastFetchAt";
                                continue;
                            }
                        case 4: {
                                if (wireType !== 2)
                                    break;
                                message.lastFetchVia = reader.stringVerify();
                                message._lastFetchVia = "lastFetchVia";
                                continue;
                            }
                        }
                        reader.skipType(wireType, _depth, tag);
                        if (!reader.discardUnknown) {
                            $util.makeProp(message, "$unknowns", false);
                            (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                        }
                    }
                    if (length !== $undefined) {
                        if (reader.pos !== end)
                            throw $RangeError("index out of range");
                        reader.len = length;
                    }
                    if (_end !== $undefined)
                        throw $Error("missing end group");
                    return message;
                };

                /**
                 * Gets the type url for MetricProvenance
                 * @function getTypeUrl
                 * @memberof outreach.postlist.v1.MetricProvenance
                 * @static
                 * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
                 * @returns {string} The type url
                 */
                MetricProvenance.getTypeUrl = function(prefix) {
                    if (prefix === $undefined)
                        prefix = "type.googleapis.com";
                    return prefix + "/outreach.postlist.v1.MetricProvenance";
                };

                return MetricProvenance;
            })();

            v1.Post = (function() {

                /**
                 * Properties of a Post.
                 * @typedef {Object} outreach.postlist.v1.Post.$Properties
                 * @property {string|null} [id] Post id
                 * @property {string|null} [platform] Post platform
                 * @property {string|null} [platformPostId] Post platformPostId
                 * @property {string|null} [postUrl] Post postUrl
                 * @property {string|null} [thumbnailUrl] Post thumbnailUrl
                 * @property {string|null} [caption] Post caption
                 * @property {string|null} [mediaType] Post mediaType
                 * @property {number|Long|null} [postedAtMs] Post postedAtMs
                 * @property {number|Long|null} [viewsCount] Post viewsCount
                 * @property {number|Long|null} [likesCount] Post likesCount
                 * @property {number|Long|null} [commentsCount] Post commentsCount
                 * @property {number|Long|null} [sharesCount] Post sharesCount
                 * @property {number|Long|null} [savesCount] Post savesCount
                 * @property {number|Long|null} [downloadsCount] Post downloadsCount
                 * @property {number|null} [engagementRate] Post engagementRate
                 * @property {string|null} [status] Post status
                 * @property {string|null} [fetchState] Post fetchState
                 * @property {string|null} [rejectionReason] Post rejectionReason
                 * @property {number|Long|null} [lastSyncedAtMs] Post lastSyncedAtMs
                 * @property {string|null} [authorProfilePic] Post authorProfilePic
                 * @property {number|Long|null} [createdAtMs] Post createdAtMs
                 * @property {boolean|null} [hasOpenFraudFlag] Post hasOpenFraudFlag
                 * @property {outreach.postlist.v1.Creator.$Properties|null} [creator] Post creator
                 * @property {Array.<outreach.postlist.v1.Snapshot.$Properties>|null} [snapshots] Post snapshots
                 * @property {Array.<outreach.postlist.v1.ComplianceFlag.$Properties>|null} [complianceFlags] Post complianceFlags
                 * @property {outreach.postlist.v1.MetricProvenance.$Properties|null} [provenance] Post provenance
                 * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
                 */

                /**
                 * Properties of a Post.
                 * @memberof outreach.postlist.v1
                 * @interface IPost
                 * @augments outreach.postlist.v1.Post.$Properties
                 * @deprecated Use outreach.postlist.v1.Post.$Properties instead.
                 */

                /**
                 * Shape of a Post.
                 * @typedef {outreach.postlist.v1.Post.$Properties} outreach.postlist.v1.Post.$Shape
                 */

                /**
                 * Constructs a new Post.
                 * @memberof outreach.postlist.v1
                 * @classdesc Represents a Post.
                 * @constructor
                 * @param {outreach.postlist.v1.Post.$Properties=} [properties] Properties to set
                 * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
                 */
                const Post = function (properties) {
                    this.snapshots = [];
                    this.complianceFlags = [];
                    if (properties)
                        for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                            if (properties[keys[i]] != null && keys[i] !== "__proto__")
                                this[keys[i]] = properties[keys[i]];
                };

                /**
                 * Post id.
                 * @member {string|null|undefined} id
                 * @memberof outreach.postlist.v1.Post
                 * @instance
                 */
                Post.prototype.id = null;

                /**
                 * Post platform.
                 * @member {string|null|undefined} platform
                 * @memberof outreach.postlist.v1.Post
                 * @instance
                 */
                Post.prototype.platform = null;

                /**
                 * Post platformPostId.
                 * @member {string|null|undefined} platformPostId
                 * @memberof outreach.postlist.v1.Post
                 * @instance
                 */
                Post.prototype.platformPostId = null;

                /**
                 * Post postUrl.
                 * @member {string|null|undefined} postUrl
                 * @memberof outreach.postlist.v1.Post
                 * @instance
                 */
                Post.prototype.postUrl = null;

                /**
                 * Post thumbnailUrl.
                 * @member {string|null|undefined} thumbnailUrl
                 * @memberof outreach.postlist.v1.Post
                 * @instance
                 */
                Post.prototype.thumbnailUrl = null;

                /**
                 * Post caption.
                 * @member {string|null|undefined} caption
                 * @memberof outreach.postlist.v1.Post
                 * @instance
                 */
                Post.prototype.caption = null;

                /**
                 * Post mediaType.
                 * @member {string|null|undefined} mediaType
                 * @memberof outreach.postlist.v1.Post
                 * @instance
                 */
                Post.prototype.mediaType = null;

                /**
                 * Post postedAtMs.
                 * @member {number|Long|null|undefined} postedAtMs
                 * @memberof outreach.postlist.v1.Post
                 * @instance
                 */
                Post.prototype.postedAtMs = null;

                /**
                 * Post viewsCount.
                 * @member {number|Long|null|undefined} viewsCount
                 * @memberof outreach.postlist.v1.Post
                 * @instance
                 */
                Post.prototype.viewsCount = null;

                /**
                 * Post likesCount.
                 * @member {number|Long|null|undefined} likesCount
                 * @memberof outreach.postlist.v1.Post
                 * @instance
                 */
                Post.prototype.likesCount = null;

                /**
                 * Post commentsCount.
                 * @member {number|Long|null|undefined} commentsCount
                 * @memberof outreach.postlist.v1.Post
                 * @instance
                 */
                Post.prototype.commentsCount = null;

                /**
                 * Post sharesCount.
                 * @member {number|Long|null|undefined} sharesCount
                 * @memberof outreach.postlist.v1.Post
                 * @instance
                 */
                Post.prototype.sharesCount = null;

                /**
                 * Post savesCount.
                 * @member {number|Long|null|undefined} savesCount
                 * @memberof outreach.postlist.v1.Post
                 * @instance
                 */
                Post.prototype.savesCount = null;

                /**
                 * Post downloadsCount.
                 * @member {number|Long|null|undefined} downloadsCount
                 * @memberof outreach.postlist.v1.Post
                 * @instance
                 */
                Post.prototype.downloadsCount = null;

                /**
                 * Post engagementRate.
                 * @member {number|null|undefined} engagementRate
                 * @memberof outreach.postlist.v1.Post
                 * @instance
                 */
                Post.prototype.engagementRate = null;

                /**
                 * Post status.
                 * @member {string|null|undefined} status
                 * @memberof outreach.postlist.v1.Post
                 * @instance
                 */
                Post.prototype.status = null;

                /**
                 * Post fetchState.
                 * @member {string|null|undefined} fetchState
                 * @memberof outreach.postlist.v1.Post
                 * @instance
                 */
                Post.prototype.fetchState = null;

                /**
                 * Post rejectionReason.
                 * @member {string|null|undefined} rejectionReason
                 * @memberof outreach.postlist.v1.Post
                 * @instance
                 */
                Post.prototype.rejectionReason = null;

                /**
                 * Post lastSyncedAtMs.
                 * @member {number|Long|null|undefined} lastSyncedAtMs
                 * @memberof outreach.postlist.v1.Post
                 * @instance
                 */
                Post.prototype.lastSyncedAtMs = null;

                /**
                 * Post authorProfilePic.
                 * @member {string|null|undefined} authorProfilePic
                 * @memberof outreach.postlist.v1.Post
                 * @instance
                 */
                Post.prototype.authorProfilePic = null;

                /**
                 * Post createdAtMs.
                 * @member {number|Long|null|undefined} createdAtMs
                 * @memberof outreach.postlist.v1.Post
                 * @instance
                 */
                Post.prototype.createdAtMs = null;

                /**
                 * Post hasOpenFraudFlag.
                 * @member {boolean|null|undefined} hasOpenFraudFlag
                 * @memberof outreach.postlist.v1.Post
                 * @instance
                 */
                Post.prototype.hasOpenFraudFlag = null;

                /**
                 * Post creator.
                 * @member {outreach.postlist.v1.Creator.$Properties|null|undefined} creator
                 * @memberof outreach.postlist.v1.Post
                 * @instance
                 */
                Post.prototype.creator = null;

                /**
                 * Post snapshots.
                 * @member {Array.<outreach.postlist.v1.Snapshot.$Properties>} snapshots
                 * @memberof outreach.postlist.v1.Post
                 * @instance
                 */
                Post.prototype.snapshots = $util.emptyArray;

                /**
                 * Post complianceFlags.
                 * @member {Array.<outreach.postlist.v1.ComplianceFlag.$Properties>} complianceFlags
                 * @memberof outreach.postlist.v1.Post
                 * @instance
                 */
                Post.prototype.complianceFlags = $util.emptyArray;

                /**
                 * Post provenance.
                 * @member {outreach.postlist.v1.MetricProvenance.$Properties|null|undefined} provenance
                 * @memberof outreach.postlist.v1.Post
                 * @instance
                 */
                Post.prototype.provenance = null;

                // OneOf field names bound to virtual getters and setters
                let $oneOfFields;

                // Virtual OneOf for proto3 optional field
                $Object.defineProperty(Post.prototype, "_id", {
                    get: $util.oneOfGetter($oneOfFields = ["id"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                $Object.defineProperty(Post.prototype, "_platform", {
                    get: $util.oneOfGetter($oneOfFields = ["platform"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                $Object.defineProperty(Post.prototype, "_platformPostId", {
                    get: $util.oneOfGetter($oneOfFields = ["platformPostId"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                $Object.defineProperty(Post.prototype, "_postUrl", {
                    get: $util.oneOfGetter($oneOfFields = ["postUrl"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                $Object.defineProperty(Post.prototype, "_thumbnailUrl", {
                    get: $util.oneOfGetter($oneOfFields = ["thumbnailUrl"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                $Object.defineProperty(Post.prototype, "_caption", {
                    get: $util.oneOfGetter($oneOfFields = ["caption"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                $Object.defineProperty(Post.prototype, "_mediaType", {
                    get: $util.oneOfGetter($oneOfFields = ["mediaType"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                $Object.defineProperty(Post.prototype, "_postedAtMs", {
                    get: $util.oneOfGetter($oneOfFields = ["postedAtMs"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                $Object.defineProperty(Post.prototype, "_viewsCount", {
                    get: $util.oneOfGetter($oneOfFields = ["viewsCount"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                $Object.defineProperty(Post.prototype, "_likesCount", {
                    get: $util.oneOfGetter($oneOfFields = ["likesCount"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                $Object.defineProperty(Post.prototype, "_commentsCount", {
                    get: $util.oneOfGetter($oneOfFields = ["commentsCount"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                $Object.defineProperty(Post.prototype, "_sharesCount", {
                    get: $util.oneOfGetter($oneOfFields = ["sharesCount"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                $Object.defineProperty(Post.prototype, "_savesCount", {
                    get: $util.oneOfGetter($oneOfFields = ["savesCount"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                $Object.defineProperty(Post.prototype, "_downloadsCount", {
                    get: $util.oneOfGetter($oneOfFields = ["downloadsCount"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                $Object.defineProperty(Post.prototype, "_engagementRate", {
                    get: $util.oneOfGetter($oneOfFields = ["engagementRate"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                $Object.defineProperty(Post.prototype, "_status", {
                    get: $util.oneOfGetter($oneOfFields = ["status"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                $Object.defineProperty(Post.prototype, "_fetchState", {
                    get: $util.oneOfGetter($oneOfFields = ["fetchState"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                $Object.defineProperty(Post.prototype, "_rejectionReason", {
                    get: $util.oneOfGetter($oneOfFields = ["rejectionReason"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                $Object.defineProperty(Post.prototype, "_lastSyncedAtMs", {
                    get: $util.oneOfGetter($oneOfFields = ["lastSyncedAtMs"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                $Object.defineProperty(Post.prototype, "_authorProfilePic", {
                    get: $util.oneOfGetter($oneOfFields = ["authorProfilePic"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                $Object.defineProperty(Post.prototype, "_createdAtMs", {
                    get: $util.oneOfGetter($oneOfFields = ["createdAtMs"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                $Object.defineProperty(Post.prototype, "_hasOpenFraudFlag", {
                    get: $util.oneOfGetter($oneOfFields = ["hasOpenFraudFlag"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                $Object.defineProperty(Post.prototype, "_creator", {
                    get: $util.oneOfGetter($oneOfFields = ["creator"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                // Virtual OneOf for proto3 optional field
                $Object.defineProperty(Post.prototype, "_provenance", {
                    get: $util.oneOfGetter($oneOfFields = ["provenance"]),
                    set: $util.oneOfSetter($oneOfFields)
                });

                /**
                 * Encodes the specified Post message. Does not implicitly {@link outreach.postlist.v1.Post.verify|verify} messages.
                 * @function encode
                 * @memberof outreach.postlist.v1.Post
                 * @static
                 * @param {outreach.postlist.v1.Post.$Properties} message Post message or plain object to encode
                 * @param {$protobuf.Writer} [writer] Writer to encode to
                 * @returns {$protobuf.Writer} Writer
                 */
                Post.encode = function (message, writer, _depth) {
                    if (!writer)
                        writer = $Writer.create();
                    if (_depth === $undefined)
                        _depth = 0;
                    if (_depth > $util.recursionLimit)
                        throw $Error("max depth exceeded");
                    if (message.id != null && $Object.hasOwnProperty.call(message, "id"))
                        writer.uint32(/* id 1, wireType 2 =*/10).string(message.id);
                    if (message.platform != null && $Object.hasOwnProperty.call(message, "platform"))
                        writer.uint32(/* id 2, wireType 2 =*/18).string(message.platform);
                    if (message.platformPostId != null && $Object.hasOwnProperty.call(message, "platformPostId"))
                        writer.uint32(/* id 3, wireType 2 =*/26).string(message.platformPostId);
                    if (message.postUrl != null && $Object.hasOwnProperty.call(message, "postUrl"))
                        writer.uint32(/* id 4, wireType 2 =*/34).string(message.postUrl);
                    if (message.thumbnailUrl != null && $Object.hasOwnProperty.call(message, "thumbnailUrl"))
                        writer.uint32(/* id 5, wireType 2 =*/42).string(message.thumbnailUrl);
                    if (message.caption != null && $Object.hasOwnProperty.call(message, "caption"))
                        writer.uint32(/* id 6, wireType 2 =*/50).string(message.caption);
                    if (message.mediaType != null && $Object.hasOwnProperty.call(message, "mediaType"))
                        writer.uint32(/* id 7, wireType 2 =*/58).string(message.mediaType);
                    if (message.postedAtMs != null && $Object.hasOwnProperty.call(message, "postedAtMs"))
                        writer.uint32(/* id 8, wireType 0 =*/64).int64(message.postedAtMs);
                    if (message.viewsCount != null && $Object.hasOwnProperty.call(message, "viewsCount"))
                        writer.uint32(/* id 9, wireType 0 =*/72).int64(message.viewsCount);
                    if (message.likesCount != null && $Object.hasOwnProperty.call(message, "likesCount"))
                        writer.uint32(/* id 10, wireType 0 =*/80).int64(message.likesCount);
                    if (message.commentsCount != null && $Object.hasOwnProperty.call(message, "commentsCount"))
                        writer.uint32(/* id 11, wireType 0 =*/88).int64(message.commentsCount);
                    if (message.sharesCount != null && $Object.hasOwnProperty.call(message, "sharesCount"))
                        writer.uint32(/* id 12, wireType 0 =*/96).int64(message.sharesCount);
                    if (message.savesCount != null && $Object.hasOwnProperty.call(message, "savesCount"))
                        writer.uint32(/* id 13, wireType 0 =*/104).int64(message.savesCount);
                    if (message.downloadsCount != null && $Object.hasOwnProperty.call(message, "downloadsCount"))
                        writer.uint32(/* id 14, wireType 0 =*/112).int64(message.downloadsCount);
                    if (message.engagementRate != null && $Object.hasOwnProperty.call(message, "engagementRate"))
                        writer.uint32(/* id 15, wireType 1 =*/121).double(message.engagementRate);
                    if (message.status != null && $Object.hasOwnProperty.call(message, "status"))
                        writer.uint32(/* id 16, wireType 2 =*/130).string(message.status);
                    if (message.fetchState != null && $Object.hasOwnProperty.call(message, "fetchState"))
                        writer.uint32(/* id 17, wireType 2 =*/138).string(message.fetchState);
                    if (message.rejectionReason != null && $Object.hasOwnProperty.call(message, "rejectionReason"))
                        writer.uint32(/* id 18, wireType 2 =*/146).string(message.rejectionReason);
                    if (message.lastSyncedAtMs != null && $Object.hasOwnProperty.call(message, "lastSyncedAtMs"))
                        writer.uint32(/* id 19, wireType 0 =*/152).int64(message.lastSyncedAtMs);
                    if (message.authorProfilePic != null && $Object.hasOwnProperty.call(message, "authorProfilePic"))
                        writer.uint32(/* id 20, wireType 2 =*/162).string(message.authorProfilePic);
                    if (message.createdAtMs != null && $Object.hasOwnProperty.call(message, "createdAtMs"))
                        writer.uint32(/* id 21, wireType 0 =*/168).int64(message.createdAtMs);
                    if (message.hasOpenFraudFlag != null && $Object.hasOwnProperty.call(message, "hasOpenFraudFlag"))
                        writer.uint32(/* id 22, wireType 0 =*/176).bool(message.hasOpenFraudFlag);
                    if (message.creator != null && $Object.hasOwnProperty.call(message, "creator"))
                        $root.outreach.postlist.v1.Creator.encode(message.creator, writer.uint32(/* id 23, wireType 2 =*/186).fork(), _depth + 1).ldelim();
                    if (message.snapshots != null && message.snapshots.length)
                        for (let i = 0; i < message.snapshots.length; ++i)
                            $root.outreach.postlist.v1.Snapshot.encode(message.snapshots[i], writer.uint32(/* id 24, wireType 2 =*/194).fork(), _depth + 1).ldelim();
                    if (message.complianceFlags != null && message.complianceFlags.length)
                        for (let i = 0; i < message.complianceFlags.length; ++i)
                            $root.outreach.postlist.v1.ComplianceFlag.encode(message.complianceFlags[i], writer.uint32(/* id 25, wireType 2 =*/202).fork(), _depth + 1).ldelim();
                    if (message.provenance != null && $Object.hasOwnProperty.call(message, "provenance"))
                        $root.outreach.postlist.v1.MetricProvenance.encode(message.provenance, writer.uint32(/* id 26, wireType 2 =*/210).fork(), _depth + 1).ldelim();
                    if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                        for (let i = 0; i < message.$unknowns.length; ++i)
                            writer.raw(message.$unknowns[i]);
                    return writer;
                };

                /**
                 * Decodes a Post message from the specified reader or buffer.
                 * @function decode
                 * @memberof outreach.postlist.v1.Post
                 * @static
                 * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                 * @param {number} [length] Message length if known beforehand
                 * @returns {outreach.postlist.v1.Post & outreach.postlist.v1.Post.$Shape} Post
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                Post.decode = function (reader, length, _end, _depth, _target) {
                    if (!(reader instanceof $Reader))
                        reader = $Reader.create(reader);
                    if (_depth === $undefined)
                        _depth = 0;
                    if (_depth > $Reader.recursionLimit)
                        throw $Error("max depth exceeded");
                    let end, message;
                    if (length === $undefined)
                        end = reader.len;
                    else {
                        end = reader.pos + length;
                        if (end > reader.len)
                            throw $RangeError("index out of range");
                        length = reader.len;
                        reader.len = end;
                    }
                    message = _target || new $root.outreach.postlist.v1.Post();
                    while (reader.pos < end) {
                        let start = reader.pos;
                        let tag = reader.tag();
                        if (tag === _end) {
                            _end = $undefined;
                            break;
                        }
                        let wireType = tag & 7;
                        switch (tag >>>= 3) {
                        case 1: {
                                if (wireType !== 2)
                                    break;
                                message.id = reader.stringVerify();
                                message._id = "id";
                                continue;
                            }
                        case 2: {
                                if (wireType !== 2)
                                    break;
                                message.platform = reader.stringVerify();
                                message._platform = "platform";
                                continue;
                            }
                        case 3: {
                                if (wireType !== 2)
                                    break;
                                message.platformPostId = reader.stringVerify();
                                message._platformPostId = "platformPostId";
                                continue;
                            }
                        case 4: {
                                if (wireType !== 2)
                                    break;
                                message.postUrl = reader.stringVerify();
                                message._postUrl = "postUrl";
                                continue;
                            }
                        case 5: {
                                if (wireType !== 2)
                                    break;
                                message.thumbnailUrl = reader.stringVerify();
                                message._thumbnailUrl = "thumbnailUrl";
                                continue;
                            }
                        case 6: {
                                if (wireType !== 2)
                                    break;
                                message.caption = reader.stringVerify();
                                message._caption = "caption";
                                continue;
                            }
                        case 7: {
                                if (wireType !== 2)
                                    break;
                                message.mediaType = reader.stringVerify();
                                message._mediaType = "mediaType";
                                continue;
                            }
                        case 8: {
                                if (wireType !== 0)
                                    break;
                                message.postedAtMs = reader.int64();
                                message._postedAtMs = "postedAtMs";
                                continue;
                            }
                        case 9: {
                                if (wireType !== 0)
                                    break;
                                message.viewsCount = reader.int64();
                                message._viewsCount = "viewsCount";
                                continue;
                            }
                        case 10: {
                                if (wireType !== 0)
                                    break;
                                message.likesCount = reader.int64();
                                message._likesCount = "likesCount";
                                continue;
                            }
                        case 11: {
                                if (wireType !== 0)
                                    break;
                                message.commentsCount = reader.int64();
                                message._commentsCount = "commentsCount";
                                continue;
                            }
                        case 12: {
                                if (wireType !== 0)
                                    break;
                                message.sharesCount = reader.int64();
                                message._sharesCount = "sharesCount";
                                continue;
                            }
                        case 13: {
                                if (wireType !== 0)
                                    break;
                                message.savesCount = reader.int64();
                                message._savesCount = "savesCount";
                                continue;
                            }
                        case 14: {
                                if (wireType !== 0)
                                    break;
                                message.downloadsCount = reader.int64();
                                message._downloadsCount = "downloadsCount";
                                continue;
                            }
                        case 15: {
                                if (wireType !== 1)
                                    break;
                                message.engagementRate = reader.double();
                                message._engagementRate = "engagementRate";
                                continue;
                            }
                        case 16: {
                                if (wireType !== 2)
                                    break;
                                message.status = reader.stringVerify();
                                message._status = "status";
                                continue;
                            }
                        case 17: {
                                if (wireType !== 2)
                                    break;
                                message.fetchState = reader.stringVerify();
                                message._fetchState = "fetchState";
                                continue;
                            }
                        case 18: {
                                if (wireType !== 2)
                                    break;
                                message.rejectionReason = reader.stringVerify();
                                message._rejectionReason = "rejectionReason";
                                continue;
                            }
                        case 19: {
                                if (wireType !== 0)
                                    break;
                                message.lastSyncedAtMs = reader.int64();
                                message._lastSyncedAtMs = "lastSyncedAtMs";
                                continue;
                            }
                        case 20: {
                                if (wireType !== 2)
                                    break;
                                message.authorProfilePic = reader.stringVerify();
                                message._authorProfilePic = "authorProfilePic";
                                continue;
                            }
                        case 21: {
                                if (wireType !== 0)
                                    break;
                                message.createdAtMs = reader.int64();
                                message._createdAtMs = "createdAtMs";
                                continue;
                            }
                        case 22: {
                                if (wireType !== 0)
                                    break;
                                message.hasOpenFraudFlag = reader.bool();
                                message._hasOpenFraudFlag = "hasOpenFraudFlag";
                                continue;
                            }
                        case 23: {
                                if (wireType !== 2)
                                    break;
                                message.creator = $root.outreach.postlist.v1.Creator.decode(reader, reader.uint32(), $undefined, _depth + 1, message.creator);
                                message._creator = "creator";
                                continue;
                            }
                        case 24: {
                                if (wireType !== 2)
                                    break;
                                if (!(message.snapshots && message.snapshots.length))
                                    message.snapshots = [];
                                message.snapshots.push($root.outreach.postlist.v1.Snapshot.decode(reader, reader.uint32(), $undefined, _depth + 1));
                                continue;
                            }
                        case 25: {
                                if (wireType !== 2)
                                    break;
                                if (!(message.complianceFlags && message.complianceFlags.length))
                                    message.complianceFlags = [];
                                message.complianceFlags.push($root.outreach.postlist.v1.ComplianceFlag.decode(reader, reader.uint32(), $undefined, _depth + 1));
                                continue;
                            }
                        case 26: {
                                if (wireType !== 2)
                                    break;
                                message.provenance = $root.outreach.postlist.v1.MetricProvenance.decode(reader, reader.uint32(), $undefined, _depth + 1, message.provenance);
                                message._provenance = "provenance";
                                continue;
                            }
                        }
                        reader.skipType(wireType, _depth, tag);
                        if (!reader.discardUnknown) {
                            $util.makeProp(message, "$unknowns", false);
                            (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                        }
                    }
                    if (length !== $undefined) {
                        if (reader.pos !== end)
                            throw $RangeError("index out of range");
                        reader.len = length;
                    }
                    if (_end !== $undefined)
                        throw $Error("missing end group");
                    return message;
                };

                /**
                 * Gets the type url for Post
                 * @function getTypeUrl
                 * @memberof outreach.postlist.v1.Post
                 * @static
                 * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
                 * @returns {string} The type url
                 */
                Post.getTypeUrl = function(prefix) {
                    if (prefix === $undefined)
                        prefix = "type.googleapis.com";
                    return prefix + "/outreach.postlist.v1.Post";
                };

                return Post;
            })();

            v1.PostList = (function() {

                /**
                 * Properties of a PostList.
                 * @typedef {Object} outreach.postlist.v1.PostList.$Properties
                 * @property {Array.<outreach.postlist.v1.Post.$Properties>|null} [posts] PostList posts
                 * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
                 */

                /**
                 * Properties of a PostList.
                 * @memberof outreach.postlist.v1
                 * @interface IPostList
                 * @augments outreach.postlist.v1.PostList.$Properties
                 * @deprecated Use outreach.postlist.v1.PostList.$Properties instead.
                 */

                /**
                 * Shape of a PostList.
                 * @typedef {outreach.postlist.v1.PostList.$Properties} outreach.postlist.v1.PostList.$Shape
                 */

                /**
                 * Constructs a new PostList.
                 * @memberof outreach.postlist.v1
                 * @classdesc Represents a PostList.
                 * @constructor
                 * @param {outreach.postlist.v1.PostList.$Properties=} [properties] Properties to set
                 * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding when enabled
                 */
                const PostList = function (properties) {
                    this.posts = [];
                    if (properties)
                        for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                            if (properties[keys[i]] != null && keys[i] !== "__proto__")
                                this[keys[i]] = properties[keys[i]];
                };

                /**
                 * PostList posts.
                 * @member {Array.<outreach.postlist.v1.Post.$Properties>} posts
                 * @memberof outreach.postlist.v1.PostList
                 * @instance
                 */
                PostList.prototype.posts = $util.emptyArray;

                /**
                 * Encodes the specified PostList message. Does not implicitly {@link outreach.postlist.v1.PostList.verify|verify} messages.
                 * @function encode
                 * @memberof outreach.postlist.v1.PostList
                 * @static
                 * @param {outreach.postlist.v1.PostList.$Properties} message PostList message or plain object to encode
                 * @param {$protobuf.Writer} [writer] Writer to encode to
                 * @returns {$protobuf.Writer} Writer
                 */
                PostList.encode = function (message, writer, _depth) {
                    if (!writer)
                        writer = $Writer.create();
                    if (_depth === $undefined)
                        _depth = 0;
                    if (_depth > $util.recursionLimit)
                        throw $Error("max depth exceeded");
                    if (message.posts != null && message.posts.length)
                        for (let i = 0; i < message.posts.length; ++i)
                            $root.outreach.postlist.v1.Post.encode(message.posts[i], writer.uint32(/* id 1, wireType 2 =*/10).fork(), _depth + 1).ldelim();
                    if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                        for (let i = 0; i < message.$unknowns.length; ++i)
                            writer.raw(message.$unknowns[i]);
                    return writer;
                };

                /**
                 * Decodes a PostList message from the specified reader or buffer.
                 * @function decode
                 * @memberof outreach.postlist.v1.PostList
                 * @static
                 * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                 * @param {number} [length] Message length if known beforehand
                 * @returns {outreach.postlist.v1.PostList & outreach.postlist.v1.PostList.$Shape} PostList
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                PostList.decode = function (reader, length, _end, _depth, _target) {
                    if (!(reader instanceof $Reader))
                        reader = $Reader.create(reader);
                    if (_depth === $undefined)
                        _depth = 0;
                    if (_depth > $Reader.recursionLimit)
                        throw $Error("max depth exceeded");
                    let end, message;
                    if (length === $undefined)
                        end = reader.len;
                    else {
                        end = reader.pos + length;
                        if (end > reader.len)
                            throw $RangeError("index out of range");
                        length = reader.len;
                        reader.len = end;
                    }
                    message = _target || new $root.outreach.postlist.v1.PostList();
                    while (reader.pos < end) {
                        let start = reader.pos;
                        let tag = reader.tag();
                        if (tag === _end) {
                            _end = $undefined;
                            break;
                        }
                        let wireType = tag & 7;
                        switch (tag >>>= 3) {
                        case 1: {
                                if (wireType !== 2)
                                    break;
                                if (!(message.posts && message.posts.length))
                                    message.posts = [];
                                message.posts.push($root.outreach.postlist.v1.Post.decode(reader, reader.uint32(), $undefined, _depth + 1));
                                continue;
                            }
                        }
                        reader.skipType(wireType, _depth, tag);
                        if (!reader.discardUnknown) {
                            $util.makeProp(message, "$unknowns", false);
                            (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                        }
                    }
                    if (length !== $undefined) {
                        if (reader.pos !== end)
                            throw $RangeError("index out of range");
                        reader.len = length;
                    }
                    if (_end !== $undefined)
                        throw $Error("missing end group");
                    return message;
                };

                /**
                 * Gets the type url for PostList
                 * @function getTypeUrl
                 * @memberof outreach.postlist.v1.PostList
                 * @static
                 * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
                 * @returns {string} The type url
                 */
                PostList.getTypeUrl = function(prefix) {
                    if (prefix === $undefined)
                        prefix = "type.googleapis.com";
                    return prefix + "/outreach.postlist.v1.PostList";
                };

                return PostList;
            })();

            return v1;
        })();

        return postlist;
    })();

    return outreach;
})();

export {
  $root as default
};
