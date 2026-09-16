import * as $protobuf from "protobufjs";
import Long = require("long");

/** Namespace outreach. */
export namespace outreach {

    /** Namespace postlist. */
    namespace postlist {

        /** Namespace v1. */
        namespace v1 {

            /**
             * Properties of a Creator.
             * @deprecated Use outreach.postlist.v1.Creator.$Properties instead.
             */
            interface ICreator extends outreach.postlist.v1.Creator.$Properties {
            }

            /** Represents a Creator. */
            class Creator {

                /**
                 * Constructs a new Creator.
                 * @param [properties] Properties to set
                 */
                constructor(properties?: outreach.postlist.v1.Creator.$Properties);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];

                /** Creator id. */
                id?: (string|null);

                /** Creator name. */
                name?: (string|null);

                /** Creator handle. */
                handle?: (string|null);

                /** Creator avatarUrl. */
                avatarUrl?: (string|null);

                /**
                 * Encodes the specified Creator message. Does not implicitly {@link outreach.postlist.v1.Creator.verify|verify} messages.
                 * @param message Creator message or plain object to encode
                 * @param [writer] Writer to encode to
                 * @returns Writer
                 */
                static encode(message: outreach.postlist.v1.Creator.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

                /**
                 * Decodes a Creator message from the specified reader or buffer.
                 * @param reader Reader or buffer to decode from
                 * @param [length] Message length if known beforehand
                 * @returns {outreach.postlist.v1.Creator & outreach.postlist.v1.Creator.$Shape} Creator
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): outreach.postlist.v1.Creator & outreach.postlist.v1.Creator.$Shape;

                /**
                 * Gets the type url for Creator
                 * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
                 * @returns The type url
                 */
                static getTypeUrl(prefix?: string): string;
            }

            namespace Creator {

                /** Properties of a Creator. */
                interface $Properties {

                    /** Creator id */
                    id?: (string|null);

                    /** Creator name */
                    name?: (string|null);

                    /** Creator handle */
                    handle?: (string|null);

                    /** Creator avatarUrl */
                    avatarUrl?: (string|null);

                    /** Unknown fields preserved while decoding when enabled */
                    $unknowns?: Uint8Array[];
                }

                /** Shape of a Creator. */
                type $Shape = outreach.postlist.v1.Creator.$Properties;
            }

            /**
             * Properties of a Snapshot.
             * @deprecated Use outreach.postlist.v1.Snapshot.$Properties instead.
             */
            interface ISnapshot extends outreach.postlist.v1.Snapshot.$Properties {
            }

            /** Represents a Snapshot. */
            class Snapshot {

                /**
                 * Constructs a new Snapshot.
                 * @param [properties] Properties to set
                 */
                constructor(properties?: outreach.postlist.v1.Snapshot.$Properties);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];

                /** Snapshot id. */
                id?: (string|null);

                /** Snapshot viewsCount. */
                viewsCount?: (number|Long|null);

                /** Snapshot recordedAtMs. */
                recordedAtMs?: (number|Long|null);

                /**
                 * Encodes the specified Snapshot message. Does not implicitly {@link outreach.postlist.v1.Snapshot.verify|verify} messages.
                 * @param message Snapshot message or plain object to encode
                 * @param [writer] Writer to encode to
                 * @returns Writer
                 */
                static encode(message: outreach.postlist.v1.Snapshot.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

                /**
                 * Decodes a Snapshot message from the specified reader or buffer.
                 * @param reader Reader or buffer to decode from
                 * @param [length] Message length if known beforehand
                 * @returns {outreach.postlist.v1.Snapshot & outreach.postlist.v1.Snapshot.$Shape} Snapshot
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): outreach.postlist.v1.Snapshot & outreach.postlist.v1.Snapshot.$Shape;

                /**
                 * Gets the type url for Snapshot
                 * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
                 * @returns The type url
                 */
                static getTypeUrl(prefix?: string): string;
            }

            namespace Snapshot {

                /** Properties of a Snapshot. */
                interface $Properties {

                    /** Snapshot id */
                    id?: (string|null);

                    /** Snapshot viewsCount */
                    viewsCount?: (number|Long|null);

                    /** Snapshot recordedAtMs */
                    recordedAtMs?: (number|Long|null);

                    /** Unknown fields preserved while decoding when enabled */
                    $unknowns?: Uint8Array[];
                }

                /** Shape of a Snapshot. */
                type $Shape = outreach.postlist.v1.Snapshot.$Properties;
            }

            /**
             * Properties of a ComplianceFlag.
             * @deprecated Use outreach.postlist.v1.ComplianceFlag.$Properties instead.
             */
            interface IComplianceFlag extends outreach.postlist.v1.ComplianceFlag.$Properties {
            }

            /** Represents a ComplianceFlag. */
            class ComplianceFlag {

                /**
                 * Constructs a new ComplianceFlag.
                 * @param [properties] Properties to set
                 */
                constructor(properties?: outreach.postlist.v1.ComplianceFlag.$Properties);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];

                /** ComplianceFlag code. */
                code?: (string|null);

                /** ComplianceFlag severity. */
                severity?: (string|null);

                /** ComplianceFlag message. */
                message?: (string|null);

                /**
                 * Encodes the specified ComplianceFlag message. Does not implicitly {@link outreach.postlist.v1.ComplianceFlag.verify|verify} messages.
                 * @param message ComplianceFlag message or plain object to encode
                 * @param [writer] Writer to encode to
                 * @returns Writer
                 */
                static encode(message: outreach.postlist.v1.ComplianceFlag.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

                /**
                 * Decodes a ComplianceFlag message from the specified reader or buffer.
                 * @param reader Reader or buffer to decode from
                 * @param [length] Message length if known beforehand
                 * @returns {outreach.postlist.v1.ComplianceFlag & outreach.postlist.v1.ComplianceFlag.$Shape} ComplianceFlag
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): outreach.postlist.v1.ComplianceFlag & outreach.postlist.v1.ComplianceFlag.$Shape;

                /**
                 * Gets the type url for ComplianceFlag
                 * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
                 * @returns The type url
                 */
                static getTypeUrl(prefix?: string): string;
            }

            namespace ComplianceFlag {

                /** Properties of a ComplianceFlag. */
                interface $Properties {

                    /** ComplianceFlag code */
                    code?: (string|null);

                    /** ComplianceFlag severity */
                    severity?: (string|null);

                    /** ComplianceFlag message */
                    message?: (string|null);

                    /** Unknown fields preserved while decoding when enabled */
                    $unknowns?: Uint8Array[];
                }

                /** Shape of a ComplianceFlag. */
                type $Shape = outreach.postlist.v1.ComplianceFlag.$Properties;
            }

            /**
             * Properties of a MetricProvenance.
             * @deprecated Use outreach.postlist.v1.MetricProvenance.$Properties instead.
             */
            interface IMetricProvenance extends outreach.postlist.v1.MetricProvenance.$Properties {
            }

            /** Represents a MetricProvenance. */
            class MetricProvenance {

                /**
                 * Constructs a new MetricProvenance.
                 * @param [properties] Properties to set
                 */
                constructor(properties?: outreach.postlist.v1.MetricProvenance.$Properties);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];

                /** MetricProvenance measured. */
                measured: string[];

                /** MetricProvenance lastFetchReason. */
                lastFetchReason?: (string|null);

                /** MetricProvenance lastFetchAt. */
                lastFetchAt?: (string|null);

                /** MetricProvenance lastFetchVia. */
                lastFetchVia?: (string|null);

                /**
                 * Encodes the specified MetricProvenance message. Does not implicitly {@link outreach.postlist.v1.MetricProvenance.verify|verify} messages.
                 * @param message MetricProvenance message or plain object to encode
                 * @param [writer] Writer to encode to
                 * @returns Writer
                 */
                static encode(message: outreach.postlist.v1.MetricProvenance.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

                /**
                 * Decodes a MetricProvenance message from the specified reader or buffer.
                 * @param reader Reader or buffer to decode from
                 * @param [length] Message length if known beforehand
                 * @returns {outreach.postlist.v1.MetricProvenance & outreach.postlist.v1.MetricProvenance.$Shape} MetricProvenance
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): outreach.postlist.v1.MetricProvenance & outreach.postlist.v1.MetricProvenance.$Shape;

                /**
                 * Gets the type url for MetricProvenance
                 * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
                 * @returns The type url
                 */
                static getTypeUrl(prefix?: string): string;
            }

            namespace MetricProvenance {

                /** Properties of a MetricProvenance. */
                interface $Properties {

                    /** MetricProvenance measured */
                    measured?: (string[]|null);

                    /** MetricProvenance lastFetchReason */
                    lastFetchReason?: (string|null);

                    /** MetricProvenance lastFetchAt */
                    lastFetchAt?: (string|null);

                    /** MetricProvenance lastFetchVia */
                    lastFetchVia?: (string|null);

                    /** Unknown fields preserved while decoding when enabled */
                    $unknowns?: Uint8Array[];
                }

                /** Shape of a MetricProvenance. */
                type $Shape = outreach.postlist.v1.MetricProvenance.$Properties;
            }

            /**
             * Properties of a Post.
             * @deprecated Use outreach.postlist.v1.Post.$Properties instead.
             */
            interface IPost extends outreach.postlist.v1.Post.$Properties {
            }

            /** Represents a Post. */
            class Post {

                /**
                 * Constructs a new Post.
                 * @param [properties] Properties to set
                 */
                constructor(properties?: outreach.postlist.v1.Post.$Properties);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];

                /** Post id. */
                id?: (string|null);

                /** Post platform. */
                platform?: (string|null);

                /** Post platformPostId. */
                platformPostId?: (string|null);

                /** Post postUrl. */
                postUrl?: (string|null);

                /** Post thumbnailUrl. */
                thumbnailUrl?: (string|null);

                /** Post caption. */
                caption?: (string|null);

                /** Post mediaType. */
                mediaType?: (string|null);

                /** Post postedAtMs. */
                postedAtMs?: (number|Long|null);

                /** Post viewsCount. */
                viewsCount?: (number|Long|null);

                /** Post likesCount. */
                likesCount?: (number|Long|null);

                /** Post commentsCount. */
                commentsCount?: (number|Long|null);

                /** Post sharesCount. */
                sharesCount?: (number|Long|null);

                /** Post savesCount. */
                savesCount?: (number|Long|null);

                /** Post downloadsCount. */
                downloadsCount?: (number|Long|null);

                /** Post engagementRate. */
                engagementRate?: (number|null);

                /** Post status. */
                status?: (string|null);

                /** Post fetchState. */
                fetchState?: (string|null);

                /** Post rejectionReason. */
                rejectionReason?: (string|null);

                /** Post lastSyncedAtMs. */
                lastSyncedAtMs?: (number|Long|null);

                /** Post authorProfilePic. */
                authorProfilePic?: (string|null);

                /** Post createdAtMs. */
                createdAtMs?: (number|Long|null);

                /** Post hasOpenFraudFlag. */
                hasOpenFraudFlag?: (boolean|null);

                /** Post creator. */
                creator?: (outreach.postlist.v1.Creator.$Properties|null);

                /** Post snapshots. */
                snapshots: outreach.postlist.v1.Snapshot.$Properties[];

                /** Post complianceFlags. */
                complianceFlags: outreach.postlist.v1.ComplianceFlag.$Properties[];

                /** Post provenance. */
                provenance?: (outreach.postlist.v1.MetricProvenance.$Properties|null);

                /** Post trackingEnabled. */
                trackingEnabled?: (boolean|null);

                /** Post trackingExpiresAtMs. */
                trackingExpiresAtMs?: (number|Long|null);

                /**
                 * Encodes the specified Post message. Does not implicitly {@link outreach.postlist.v1.Post.verify|verify} messages.
                 * @param message Post message or plain object to encode
                 * @param [writer] Writer to encode to
                 * @returns Writer
                 */
                static encode(message: outreach.postlist.v1.Post.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

                /**
                 * Decodes a Post message from the specified reader or buffer.
                 * @param reader Reader or buffer to decode from
                 * @param [length] Message length if known beforehand
                 * @returns {outreach.postlist.v1.Post & outreach.postlist.v1.Post.$Shape} Post
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): outreach.postlist.v1.Post & outreach.postlist.v1.Post.$Shape;

                /**
                 * Gets the type url for Post
                 * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
                 * @returns The type url
                 */
                static getTypeUrl(prefix?: string): string;
            }

            namespace Post {

                /** Properties of a Post. */
                interface $Properties {

                    /** Post id */
                    id?: (string|null);

                    /** Post platform */
                    platform?: (string|null);

                    /** Post platformPostId */
                    platformPostId?: (string|null);

                    /** Post postUrl */
                    postUrl?: (string|null);

                    /** Post thumbnailUrl */
                    thumbnailUrl?: (string|null);

                    /** Post caption */
                    caption?: (string|null);

                    /** Post mediaType */
                    mediaType?: (string|null);

                    /** Post postedAtMs */
                    postedAtMs?: (number|Long|null);

                    /** Post viewsCount */
                    viewsCount?: (number|Long|null);

                    /** Post likesCount */
                    likesCount?: (number|Long|null);

                    /** Post commentsCount */
                    commentsCount?: (number|Long|null);

                    /** Post sharesCount */
                    sharesCount?: (number|Long|null);

                    /** Post savesCount */
                    savesCount?: (number|Long|null);

                    /** Post downloadsCount */
                    downloadsCount?: (number|Long|null);

                    /** Post engagementRate */
                    engagementRate?: (number|null);

                    /** Post status */
                    status?: (string|null);

                    /** Post fetchState */
                    fetchState?: (string|null);

                    /** Post rejectionReason */
                    rejectionReason?: (string|null);

                    /** Post lastSyncedAtMs */
                    lastSyncedAtMs?: (number|Long|null);

                    /** Post authorProfilePic */
                    authorProfilePic?: (string|null);

                    /** Post createdAtMs */
                    createdAtMs?: (number|Long|null);

                    /** Post hasOpenFraudFlag */
                    hasOpenFraudFlag?: (boolean|null);

                    /** Post creator */
                    creator?: (outreach.postlist.v1.Creator.$Properties|null);

                    /** Post snapshots */
                    snapshots?: (outreach.postlist.v1.Snapshot.$Properties[]|null);

                    /** Post complianceFlags */
                    complianceFlags?: (outreach.postlist.v1.ComplianceFlag.$Properties[]|null);

                    /** Post provenance */
                    provenance?: (outreach.postlist.v1.MetricProvenance.$Properties|null);

                    /** Post trackingEnabled */
                    trackingEnabled?: (boolean|null);

                    /** Post trackingExpiresAtMs */
                    trackingExpiresAtMs?: (number|Long|null);

                    /** Unknown fields preserved while decoding when enabled */
                    $unknowns?: Uint8Array[];
                }

                /** Shape of a Post. */
                type $Shape = outreach.postlist.v1.Post.$Properties;
            }

            /**
             * Properties of a PostList.
             * @deprecated Use outreach.postlist.v1.PostList.$Properties instead.
             */
            interface IPostList extends outreach.postlist.v1.PostList.$Properties {
            }

            /** Represents a PostList. */
            class PostList {

                /**
                 * Constructs a new PostList.
                 * @param [properties] Properties to set
                 */
                constructor(properties?: outreach.postlist.v1.PostList.$Properties);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];

                /** PostList posts. */
                posts: outreach.postlist.v1.Post.$Properties[];

                /**
                 * Encodes the specified PostList message. Does not implicitly {@link outreach.postlist.v1.PostList.verify|verify} messages.
                 * @param message PostList message or plain object to encode
                 * @param [writer] Writer to encode to
                 * @returns Writer
                 */
                static encode(message: outreach.postlist.v1.PostList.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

                /**
                 * Decodes a PostList message from the specified reader or buffer.
                 * @param reader Reader or buffer to decode from
                 * @param [length] Message length if known beforehand
                 * @returns {outreach.postlist.v1.PostList & outreach.postlist.v1.PostList.$Shape} PostList
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): outreach.postlist.v1.PostList & outreach.postlist.v1.PostList.$Shape;

                /**
                 * Gets the type url for PostList
                 * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
                 * @returns The type url
                 */
                static getTypeUrl(prefix?: string): string;
            }

            namespace PostList {

                /** Properties of a PostList. */
                interface $Properties {

                    /** PostList posts */
                    posts?: (outreach.postlist.v1.Post.$Properties[]|null);

                    /** Unknown fields preserved while decoding when enabled */
                    $unknowns?: Uint8Array[];
                }

                /** Shape of a PostList. */
                type $Shape = outreach.postlist.v1.PostList.$Properties;
            }
        }
    }
}
