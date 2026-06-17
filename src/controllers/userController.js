const db = require('../config/db');

const updateLiveLocation = async (req, res) => {
  const { user_id, latitude, longitude } = req.body;

  try {
    await db.query(
      'UPDATE users SET latitude = $1, longitude = $2 WHERE id = $3',
      [parseFloat(latitude), parseFloat(longitude), parseInt(user_id, 10)]
    );

    res.status(200).json({ success: true, message: 'Live GPS location updated in database.' });
  } catch (error) {
    console.error('Background GPS Update Error:', error);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

module.exports = {
  updateLiveLocation
};