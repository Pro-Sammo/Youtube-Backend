import mongoose from "mongoose";
import { Comment } from "../models/comment.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const getVideoComments = asyncHandler(async (req, res) => {

  const { videoId } = req.params;
  const { page = 1, limit = 10 } = req.query;

  if (!mongoose.isValidObjectId(videoId)) {
    throw new ApiError(400, "Invalid video Id");
  }

  const comment = await Comment.aggregatePaginate(
    Comment.aggregate([
      {
        $match: {
          video: new mongoose.Types.ObjectId(videoId),
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
              $project: {
                username: 1,
                fullName: 1,
                avatar: 1,
              },
            },
          ],
        },
      },
      {
        $lookup:{
          from:"likes",
          localField:"_id",
          foreignField:"comment",
          as:"like"
        }
      },
      {
        $addFields:{
          likesCount:{
            $size:"$like"
          },
          isLiked:{
            $cond:{
              if:{$in:[new mongoose.Types.ObjectId(req.user._id),"$like.likedBy"]},
              then:true,
              else:false
            }
          }
        }
      },
      {
        $unwind: "$owner",
      },
      {
        $project: {
          content:1,
          owner:1,
          createdAt:1,
          updatedAt:1,
          likesCount:1,
          isLiked:1
        },
      },
    ]),
    {
      page: page,
      limit: limit,
    }
  );


  return res.status(200).json(new ApiResponse(200,comment,"Comment Fetched Successfully"))

});

const addComment = asyncHandler(async (req, res) => {
  const { videoId } = req.params;
  const { content } = req.body;

  if (!mongoose.isValidObjectId(videoId)) {
    throw new ApiError(400, "Invalid video Id");
  }

  if (!content) {
    throw new ApiError(400, "Comment is required");
  }

  const comment = await Comment.create({
    content: content,
    video: videoId,
    owner: req.user._id,
  });

  if (!comment) {
    throw new ApiError(400, "Something went wrong while db operation");
  }

  return res
    .status(200)
    .json(new ApiResponse(200, comment, "comment posted successfully"));
});

const updateComment = asyncHandler(async (req, res) => {
  const { commentId } = req.params;
  const { content } = req.body;

  if (!mongoose.isValidObjectId(commentId)) {
    throw new ApiError(400, "Invalid comment Id");
  }

  if(!content){
    throw new ApiError(400,"Content is required")
  }

  const comment = await Comment.findByIdAndUpdate(
    commentId,
    {
      $set: {
        content: content,
      },
    },
    { new: true }
  );

  if (!comment) {
    throw new ApiError(400, "Something went wrong while db operation");
  }

  return res
    .status(200)
    .json(new ApiResponse(200, comment, "comment updated successfully"));
});

const deleteComment = asyncHandler(async (req, res) => {
  const { commentId } = req.params;

  if (!mongoose.isValidObjectId(commentId)) {
    throw new ApiError(400, "Invalid comment Id");
  }

  const comment = await Comment.findByIdAndDelete(commentId);

  if (!comment) {
    throw new ApiError(400, "Something went wrong while db operation");
  }

  return res
    .status(200)
    .json(new ApiResponse(200, {}, "comment deleted successfully"));
});

export { getVideoComments, addComment, updateComment, deleteComment };
