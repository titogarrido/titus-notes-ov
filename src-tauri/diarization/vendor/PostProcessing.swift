// Adapted from soniqo/speech-swift, revision ca382eec35c3675be9670081612e19ad9496f4c7.
// Apache-2.0; see LICENSE and NOTICE. Core ML offline subset for Titus Notes.
import CoreML
import Foundation

/// Shared helpers for diarization post-processing, used by both
/// PyannoteDiarizationPipeline and SortformerDiarizer.
enum DiarizationHelpers {

    /// Merge adjacent segments from the same speaker when the gap is below `minSilence`.
    ///
    /// Segments are grouped per-speaker, merged within each group, then sorted globally.
    static func mergeSegments(
        _ segments: [DiarizedSegment],
        minSilence: Float
    ) -> [DiarizedSegment] {
        guard !segments.isEmpty else { return [] }

        var bySpeaker = [Int: [DiarizedSegment]]()
        for seg in segments {
            bySpeaker[seg.speakerId, default: []].append(seg)
        }

        var merged = [DiarizedSegment]()
        for (spk, spkSegs) in bySpeaker {
            let sorted = spkSegs.sorted { $0.startTime < $1.startTime }
            var current = sorted[0]

            for i in 1..<sorted.count {
                let next = sorted[i]
                if next.startTime - current.endTime < minSilence {
                    current = DiarizedSegment(
                        startTime: current.startTime,
                        endTime: next.endTime,
                        speakerId: spk
                    )
                } else {
                    merged.append(current)
                    current = next
                }
            }
            merged.append(current)
        }

        merged.sort { $0.startTime < $1.startTime }
        return merged
    }

    /// Remap speaker IDs to a contiguous 0-based range in ascending original-ID order.
    static func compactSpeakerIds(_ segments: [DiarizedSegment]) -> [DiarizedSegment] {
        compactSpeakerIdsWithMapping(segments).segments
    }

    /// Remap speaker IDs and their centroid embeddings together.
    ///
    /// Clustering can produce a centroid that has no surviving segment after
    /// center-zone clipping and minimum-duration filtering. Compacting only the
    /// segments would then shift their IDs while leaving the centroid array in
    /// the old coordinate space. This helper keeps both outputs aligned.
    static func compactSpeakerIdsAndEmbeddings(
        _ segments: [DiarizedSegment],
        speakerEmbeddings: [[Float]],
        missingEmbeddingDimension: Int = 256
    ) -> (segments: [DiarizedSegment], speakerEmbeddings: [[Float]]) {
        let compacted = compactSpeakerIdsWithMapping(segments)
        let dimension = speakerEmbeddings.first(where: { !$0.isEmpty })?.count
            ?? missingEmbeddingDimension
        let zeroEmbedding = [Float](repeating: 0, count: max(0, dimension))
        let compactedEmbeddings = compacted.originalSpeakerIds.map { speakerId in
            speakerEmbeddings.indices.contains(speakerId)
                ? speakerEmbeddings[speakerId]
                : zeroEmbedding
        }
        return (compacted.segments, compactedEmbeddings)
    }

    private static func compactSpeakerIdsWithMapping(
        _ segments: [DiarizedSegment]
    ) -> (segments: [DiarizedSegment], originalSpeakerIds: [Int]) {
        let usedIds = Set(segments.map(\.speakerId)).sorted()
        let idMap = Dictionary(uniqueKeysWithValues: usedIds.enumerated().map { ($1, $0) })
        let compacted = segments.map {
            DiarizedSegment(
                startTime: $0.startTime,
                endTime: $0.endTime,
                speakerId: idMap[$0.speakerId] ?? $0.speakerId
            )
        }
        return (compacted, usedIds)
    }

    static func resample(_ audio: [Float], from sourceSR: Int, to targetSR: Int) -> [Float] {
        precondition(sourceSR == targetSR, "Titus passes mono 16 kHz PCM")
        return audio
    }
}

public struct DiarizationConfig: Sendable {
    /// Onset threshold for speaker activity
    public var onset: Float
    /// Offset threshold for speaker activity
    public var offset: Float
    /// Minimum speech segment duration in seconds
    public var minSpeechDuration: Float
    /// Minimum silence duration between segments in seconds
    public var minSilenceDuration: Float
    /// Cosine distance threshold for merging speaker clusters (0.0-2.0).
    /// Lower = more merges (fewer speakers). Default 0.715.
    public var clusteringThreshold: Float

    public init(
        onset: Float = 0.5,
        offset: Float = 0.3,
        minSpeechDuration: Float = 0.3,
        minSilenceDuration: Float = 0.15,
        clusteringThreshold: Float = 0.715
    ) {
        self.onset = onset
        self.offset = offset
        self.minSpeechDuration = minSpeechDuration
        self.minSilenceDuration = minSilenceDuration
        self.clusteringThreshold = clusteringThreshold
    }

    public static let `default` = DiarizationConfig()

    /// Sortformer default: NeMo binarizes with a symmetric 0.5/0.5
    /// onset/offset, and the 0.3 hysteresis offset tuned for the pyannote
    /// pipeline measurably inflates false alarms on Sortformer activity.
    public static let sortformer = DiarizationConfig(offset: 0.5)
}

// MARK: - Result

/// Result of speaker diarization.
public struct DiarizationResult: Sendable {
    /// Diarized speech segments with speaker IDs
    public let segments: [DiarizedSegment]
    /// Number of distinct speakers found
    public let numSpeakers: Int
    /// Centroid embedding for each speaker (speaker ID → 256-dim embedding)
    public let speakerEmbeddings: [[Float]]

    public init(segments: [DiarizedSegment], numSpeakers: Int, speakerEmbeddings: [[Float]]) {
        self.segments = segments
        self.numSpeakers = numSpeakers
        self.speakerEmbeddings = speakerEmbeddings
    }
}


public struct DiarizedSegment: Sendable {
    /// Start time in seconds
    public let startTime: Float
    /// End time in seconds
    public let endTime: Float
    /// Speaker identifier (0-based)
    public let speakerId: Int

    public init(startTime: Float, endTime: Float, speakerId: Int) {
        self.startTime = startTime
        self.endTime = endTime
        self.speakerId = speakerId
    }

    /// Duration in seconds
    public var duration: Float { endTime - startTime }
}

enum SortformerDiarizer {
    static func binarize(
        probs: [Float],
        frameCount: Int,
        audioDuration: Float,
        config: SortformerConfig,
        thresholds: DiarizationConfig
    ) -> [DiarizedSegment] {
        guard frameCount > 0 else { return [] }
        let numSpeakers = config.maxSpeakers
        var allProbs = probs

        // Apply sigmoid if predictions are logits
        for i in 0..<allProbs.count {
            if allProbs[i] > 1.0 || allProbs[i] < 0.0 {
                allProbs[i] = 1.0 / (1.0 + exp(-allProbs[i]))
            }
        }

        let frameDuration = Float(config.predictionSubsamplingFactor * config.hopLength)
            / Float(config.sampleRate)
        var allSegments = [DiarizedSegment]()
        for spk in 0..<numSpeakers {
            var track = [Float](repeating: 0, count: frameCount)
            for f in 0..<frameCount {
                track[f] = allProbs[f * numSpeakers + spk]
            }

            let rawSegments = PowersetDecoder.binarize(
                probs: track,
                onset: thresholds.onset,
                offset: thresholds.offset,
                frameDuration: frameDuration
            )

            for seg in rawSegments {
                let duration = seg.endTime - seg.startTime
                guard duration >= thresholds.minSpeechDuration else { continue }
                allSegments.append(DiarizedSegment(
                    startTime: seg.startTime,
                    endTime: min(seg.endTime, audioDuration),
                    speakerId: spk
                ))
            }
        }

        allSegments.sort { $0.startTime < $1.startTime }
        let merged = DiarizationHelpers.mergeSegments(
            allSegments, minSilence: thresholds.minSilenceDuration)
        return DiarizationHelpers.compactSpeakerIds(merged)
    }

}
enum PowersetDecoder {
    static func binarize(
        probs: [Float],
        onset: Float,
        offset: Float,
        frameDuration: Float
    ) -> [(startTime: Float, endTime: Float)] {
        var segments = [(startTime: Float, endTime: Float)]()
        var inSpeech = false
        var speechStart: Float = 0

        for (i, prob) in probs.enumerated() {
            let time = Float(i) * frameDuration

            if !inSpeech && prob >= onset {
                inSpeech = true
                speechStart = time
            } else if inSpeech && prob < offset {
                inSpeech = false
                segments.append((speechStart, time))
            }
        }

        if inSpeech {
            let endTime = Float(probs.count) * frameDuration
            segments.append((speechStart, endTime))
        }

        return segments
    }
}
enum SortformerCoreMLModel {
    static func denseFloats(from array: MLMultiArray) -> [Float] {
        let dims = array.shape.count
        let shape = (0..<dims).map { array.shape[$0].intValue }
        let strides = (0..<dims).map { array.strides[$0].intValue }
        let count = shape.reduce(1, *)
        var out = [Float](repeating: 0, count: count)

        func fill(read: (Int) -> Float) {
            var logical = 0
            var index = [Int](repeating: 0, count: dims)
            while logical < count {
                var offset = 0
                for d in 0..<dims { offset += index[d] * strides[d] }
                out[logical] = read(offset)
                logical += 1
                var d = dims - 1
                while d >= 0 {
                    index[d] += 1
                    if index[d] < shape[d] { break }
                    index[d] = 0
                    d -= 1
                }
            }
        }

        switch array.dataType {
        case .float16:
            let ptr = array.dataPointer.assumingMemoryBound(to: Float16.self)
            fill { Float(ptr[$0]) }
        case .float32:
            let ptr = array.dataPointer.assumingMemoryBound(to: Float.self)
            fill { ptr[$0] }
        case .double:
            let ptr = array.dataPointer.assumingMemoryBound(to: Double.self)
            fill { Float(ptr[$0]) }
        default:
            for i in 0..<count { out[i] = array[i].floatValue }
        }
        return out
    }

}
