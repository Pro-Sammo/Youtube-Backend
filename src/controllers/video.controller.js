import mongoose from "mongoose";
import { Video } from "../models/video.model.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import {
  deleteUploadedImageFile,
  deleteUploadedVideoFile,
  uploadOnCloudinary,
} from "../utils/cloudinary.js";
import { getVideoDurationInSeconds } from "get-video-duration";
import { User } from "../models/user.model.js";

export const publishAVideo = asyncHandler(async (req, res) => {
  const { title, description } = req.body;
  if (!title || !description) {
    throw new ApiError(400, "All fields are required");
  }

  const videoLocalPath = req.files?.videoFile[0].path;
  const thumbnailLocalPath = req.files?.thumbnail[0].path;

  const videoFile = await uploadOnCloudinary(videoLocalPath);
  const thumbnail = await uploadOnCloudinary(thumbnailLocalPath);

  if (!videoFile) {
    throw new ApiError(400, "Video file is required");
  }

  if (!thumbnail) {
    throw new ApiError(400, "Thumbnail file is required");
  }

  const duration = await getVideoDurationInSeconds(videoFile.url);

  const video = await Video.create({
    video: {
      public_id: videoFile.public_id,
      url: videoFile.url,
    },
    thumbnail: {
      public_id: thumbnail.public_id,
      url: thumbnail.url,
    },
    title: title,
    description: description,
    duration: duration,
    owner: req.user._id,
  });

  return res
    .status(200)
    .json(new ApiResponse(200, video, "Video published successfully"));
});

export const getAllVideos = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, query, sortBy, sortType, userId } = req.query;

  const allVideo = await Video.aggregatePaginate(
    Video.aggregate([
      {
        $lookup: {
          from: "users",
          localField: "owner",
          foreignField: "_id",
          as: "owner",
          pipeline: [
            {
              $lookup: {
                from: "subscriptions",
                localField: "_id",
                foreignField: "channel",
                as: "subscribers",
              },
            },
            {
              $addFields: {
                subscribersCount: {
                  $size: "$subscribers",
                },
              },
            },
            {
              $project: {
                fullName: 1,
                username: 1,
                avatar: 1,
                subscribersCount: 1,
                duration: 1,
              },
            },
          ],
        },
      },
    ]),
    {
      page: page,
      limit: limit,
    }
  );

  return res
    .status(200)
    .json(new ApiResponse(200, allVideo, "All video fetch successful"));
});

export const getVideoById = asyncHandler(async (req, res) => {
  const { videoId } = req.params;
  if (!mongoose.isValidObjectId(videoId)) {
    throw new ApiError(400, "Invalid Video Id");
  }

  await Video.findByIdAndUpdate(videoId, {
    $inc: { views: 1 },
  });

  const video = await Video.aggregate([
    {
      $match: {
        _id: new mongoose.Types.ObjectId(videoId),
        isPublished: true,
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "owner",
        foreignField: "_id",
        as: "owner",
        pipeline: [
          {
            $lookup: {
              from: "subscriptions",
              localField: "_id",
              foreignField: "channel",
              as: "subscribers",
            },
          },
          {
            $addFields: {
              subscribersCount: {
                $size: "$subscribers",
              },
              isSubscribed: {
                $cond: {
                  if: { $in: [req.user?._id, "$subscribers.subscriber"] },
                  then: true,
                  else: false,
                },
              },
            },
          },
          {
            $project: {
              fullName: 1,
              username: 1,
              avatar: 1,
              subscribersCount: 1,
              isSubscribed: 1,
              duration: 1,
            },
          },
        ],
      },
    },
    {
      $lookup: {
        from: "likes",
        localField: "_id",
        foreignField: "video",
        as: "like",
      },
    },
    {
      $addFields: {
        likesCount: {
          $size: "$like",
        },
        isLiked: {
          $cond: {
            if: {
              $in: [new mongoose.Types.ObjectId(req.user._id), "$like.likedBy"],
            },
            then: true,
            else: false,
          },
        },
      },
    },
    {
      $unwind: "$owner",
    },
    {
      $project: {
        video: 1,
        thumbnail: 1,
        title: 1,
        description: 1,
        duration: 1,
        views: 1,
        owner: 1,
        createdAt: 1,
        updatedAt: 1,
        likesCount: 1,
        isLiked: 1,
      },
    },
  ]);

  const alreadyExists = await User.aggregate([
    {
      $match: {
        _id: new mongoose.Types.ObjectId(req.user._id),
      },
    },
    {
      $addFields: {
        isExist: {
          $in: [new mongoose.Types.ObjectId(videoId), "$watchHistory"],
        },
      },
    },
  ]);

  if (!alreadyExists[0].isExist) {
    await User.findByIdAndUpdate(req.user._id, {
      $push: {
        watchHistory: videoId,
      },
    });
  }
  if (!video) {
    throw new ApiError(400, "Something went wrong while db operation");
  }

  return res
    .status(200)
    .json(new ApiResponse(200, video[0], "Video fetched successfully"));
});

export const deleteVideo = asyncHandler(async (req, res) => {
  const { videoId } = req.params;
  if (!mongoose.isValidObjectId(videoId)) {
    throw new ApiError(400, "Invalid video Id");
  }

  const video = await Video.aggregate([
    {
      $match: {
        _id: new mongoose.Types.ObjectId(videoId),
        owner: new mongoose.Types.ObjectId(req.user._id),
      },
    },
  ]);

  if (!video) {
    throw new ApiError(400, "Video not available");
  }

  await deleteUploadedVideoFile(video[0].video.public_id);
  await deleteUploadedImageFile(video[0].thumbnail.public_id);

  await Video.findByIdAndDelete(video[0]._id);

  return res
    .status(200)
    .json(new ApiResponse(200, {}, "video deleted successfully"));
});

export const updateVideoThumbnail = asyncHandler(async (req, res) => {
  const { videoId } = req.params;
  if (!mongoose.isValidObjectId(videoId)) {
    throw new ApiError(400, "Video id not available");
  }
  const video = await Video.findOne({ _id: videoId, owner: req.user._id });

  if (!video) {
    throw new ApiError(400, "Video not available");
  }
  await deleteUploadedImageFile(video.thumbnail.public_id);

  const thumbnailLocalPath = req.file?.path;

  if (!thumbnailLocalPath) {
    throw new ApiError(400, "Thumbnail file is missing");
  }

  const thumbnail = await uploadOnCloudinary(thumbnailLocalPath);

  if (!thumbnail) {
    throw new ApiError(400, "Error while uploading on thumbnail");
  }

  const updatedVideo = await Video.findByIdAndUpdate(
    videoId,
    {
      $set: {
        thumbnail: {
          public_id: thumbnail.public_id,
          url: thumbnail.url,
        },
      },
    },
    {
      new: true,
    }
  );

  return res
    .status(200)
    .json(new ApiResponse(200, updatedVideo, "Thumbnail changed successful"));
});

export const togglePublishStatus = asyncHandler(async (req, res) => {
  const { videoId } = req.params;

  if (!mongoose.isValidObjectId(videoId)) {
    throw new ApiError(400, "Video id not available");
  }

  const video = await Video.findOne({ _id: videoId, owner: req.user._id });
  if (!video) {
    throw new ApiError(400, "Video not available");
  }

  if (video.isPublished === true) {
    video.isPublished = false;
  } else {
    video.isPublished = true;
  }
  await video.save({ validateBeforeSave: false });
  return res.status(200).json({
    success: true,
  });
});
