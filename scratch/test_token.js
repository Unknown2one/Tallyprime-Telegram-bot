const axios = require('axios');
require('dotenv').config();

const token = process.env.BOT_TOKEN;
console.log("Testing token:", token);

axios.get(`https://api.telegram.org/bot${token}/getMe`)
  .then(res => {
    console.log("Success:", res.data);
  })
  .catch(err => {
    if (err.response) {
      console.log("Error response:", err.response.status, err.response.data);
    } else {
      console.log("Error message:", err.message);
    }
  });
