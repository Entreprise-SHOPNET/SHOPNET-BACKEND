

const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('./cloudinary');

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'shopnet',
    allowed_formats: ['jpg', 'png', 'jpeg'],

    transformation: [
      {
        width: 1200,
        crop: 'limit',
        quality: 'auto'
      },

      {
        overlay: 'text:Arial_40:SHOPNET%20%E2%80%A2%20Verified',
        gravity: 'center',
        opacity: 40,
        color: 'white'
      }
    ]
  }
});

const upload = multer({ storage });

module.exports = upload;
