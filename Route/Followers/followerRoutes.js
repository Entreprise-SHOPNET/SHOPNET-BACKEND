const express = require("express");
const router = express.Router();

const db = require("../../db");
const authMiddleware = require("../../middlewares/authMiddleware");
const sendPushNotification = require("../../utils/sendPushNotification");


// ======================================================
// SUIVRE UN VENDEUR
// POST /api/followers/:sellerId
// ======================================================
router.post("/:sellerId", authMiddleware, async (req, res) => {
  try {

    const sellerId = req.params.sellerId;
    const followerId = req.userId;


    // Empêcher de se suivre soi-même
    if (sellerId == followerId) {
      return res.status(400).json({
        success: false,
        message: "Vous ne pouvez pas vous suivre vous-même",
      });
    }


    // Vérifier que le vendeur existe
    const [seller] = await db.query(
      `SELECT id FROM utilisateurs WHERE id = ?`,
      [sellerId]
    );


    if (seller.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Utilisateur introuvable",
      });
    }



    // Insérer le follow
    await db.query(
      `INSERT INTO followers (user_id, follower_id) VALUES (?, ?)`,
      [sellerId, followerId]
    );



    // ======================================================
    // 🔔 NOTIFICATION PUSH AU VENDEUR
    // ======================================================


    // Récupérer les informations du nouvel abonné
    const [followerRows] = await db.query(
      `
      SELECT 
        id,
        fullName,
        profile_photo,
        avatar
      FROM utilisateurs
      WHERE id = ?
      `,
      [followerId]
    );


    if (followerRows.length > 0) {

      const follower = followerRows[0];


      // Récupérer token FCM du vendeur
      const [sellerTokenRows] = await db.query(
        `
        SELECT fcm_token 
        FROM fcm_tokens 
        WHERE user_id = ?
        `,
        [sellerId]
      );



      if (
        sellerTokenRows.length > 0 &&
        sellerTokenRows[0].fcm_token
      ) {


        const followerImage =
          follower.profile_photo ||
          follower.avatar ||
          null;



        await sendPushNotification(

          sellerTokenRows[0].fcm_token,


          "⭐ Un nouvel abonné pour votre boutique",


          `${follower.fullName} suit maintenant votre boutique. Consultez votre liste d’abonnés et développez votre relation avec vos clients sur SHOPNET.`,


          {
            type: "new_follower",

            screen: "FollowersList",

            followerId: follower.id,

            image: followerImage
          }

        );


      } else {

        console.log(
          "⚠️ Aucun token FCM trouvé pour le vendeur:",
          sellerId
        );

      }

    }



    res.json({
      success: true,
      message: "Vous suivez maintenant ce vendeur",
    });



  } catch (error) {


    // doublon unique_follow
    if (error.code === "ER_DUP_ENTRY") {

      return res.status(409).json({
        success: false,
        message: "Vous suivez déjà ce vendeur",
      });

    }


    console.error("FOLLOW ERROR:", error);


    res.status(500).json({
      success: false,
      message: "Erreur serveur",
    });

  }
});




// ======================================================
// NE PLUS SUIVRE
// DELETE /api/followers/:sellerId
// ======================================================
router.delete("/:sellerId", authMiddleware, async (req, res) => {

  try {

    const sellerId = req.params.sellerId;
    const followerId = req.userId;


    await db.query(
      `DELETE FROM followers WHERE user_id = ? AND follower_id = ?`,
      [sellerId, followerId]
    );


    res.json({
      success: true,
      message: "Vous ne suivez plus ce vendeur",
    });


  } catch (error) {


    console.error("UNFOLLOW ERROR:", error);


    res.status(500).json({
      success: false,
      message: "Erreur serveur",
    });

  }

});




// ======================================================
// VERIFIER SI L'UTILISATEUR SUIT LE VENDEUR
// GET /api/followers/check/:sellerId
// ======================================================
router.get("/check/:sellerId", authMiddleware, async (req,res)=>{


  try {


    const sellerId = req.params.sellerId;
    const followerId = req.userId;



    const [rows] = await db.query(
      `
      SELECT id 
      FROM followers 
      WHERE user_id = ? 
      AND follower_id = ? 
      LIMIT 1
      `,
      [
        sellerId,
        followerId
      ]
    );


    res.json({

      success:true,

      following: rows.length > 0

    });



  } catch(error){


    console.error("CHECK FOLLOW ERROR:",error);


    res.status(500).json({

      success:false,

      message:"Erreur serveur"

    });


  }


});



// ======================================================
// NOMBRE DE FOLLOWERS D'UN VENDEUR
// ======================================================
router.get("/count/:sellerId", async(req,res)=>{


try{


const sellerId=req.params.sellerId;


const [rows]=await db.query(

`SELECT COUNT(*) AS followersCount 
FROM followers 
WHERE user_id=?`,

[sellerId]

);


res.json({

success:true,

followersCount:rows[0].followersCount

});


}catch(error){


console.error(error);


res.status(500).json({

success:false,

message:"Erreur serveur"

});


}


});



// ======================================================
// LISTE DES ABONNÉS DU VENDEUR CONNECTÉ
// ======================================================
router.get("/list", authMiddleware, async(req,res)=>{


try{


const sellerId=req.userId;


const [followers]=await db.query(

`
SELECT
u.id,
u.fullName,
u.phone,
u.profile_photo,
u.avatar,
u.role,
f.created_at

FROM followers f

INNER JOIN utilisateurs u 
ON f.follower_id=u.id

WHERE f.user_id=?

ORDER BY f.created_at DESC

`,

[sellerId]

);



const formattedFollowers = followers.map(follower=>({

id:follower.id,

fullName:follower.fullName,

phone:follower.phone,

profilePhoto:
follower.profile_photo ||
follower.avatar ||
null,

role:follower.role,

followedAt:follower.created_at

}));



res.json({

success:true,

followersCount:followers.length,

followers:formattedFollowers

});



}catch(error){


console.error(
"FOLLOWERS LIST ERROR:",
error
);


res.status(500).json({

success:false,

message:"Erreur serveur"

});


}


});



module.exports = router;
