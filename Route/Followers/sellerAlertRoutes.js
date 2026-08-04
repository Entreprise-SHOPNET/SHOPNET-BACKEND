
const express = require("express");
const router = express.Router();

const db = require("../../db");
const authMiddleware = require("../../middlewares/authMiddleware");
const sendPushNotification = require("../../utils/sendPushNotification");



// ======================================================
// CREER UNE ALERTE POUR SES ABONNES
// POST /api/followers/alert
// ======================================================

router.post("/alert", authMiddleware, async (req, res) => {

    try {

        const sellerId = req.userId;

        const {
            title,
            message,
            type = "info",
            product_id
        } = req.body;



        if (!title || !message) {

            return res.status(400).json({
                success:false,
                message:"Titre et message obligatoires"
            });

        }



        let imageUrl = null;



        // ======================================================
        // VERIFIER PRODUIT + RECUPERER IMAGE
        // ======================================================

        if(product_id){


            const [products] = await db.query(
                `
                SELECT id 
                FROM products
                WHERE id=? 
                AND seller_id=?
                `,
                [
                    product_id,
                    sellerId
                ]
            );


            if(products.length === 0){

                return res.status(403).json({
                    success:false,
                    message:"Ce produit ne vous appartient pas"
                });

            }



            const [images] = await db.query(
                `
                SELECT 
                    image_path,
                    absolute_url
                FROM product_images
                WHERE product_id=?
                ORDER BY is_primary DESC
                LIMIT 1
                `,
                [
                    product_id
                ]
            );



            if(images.length > 0){

                imageUrl =
                    images[0].absolute_url ||
                    images[0].image_path;

            }


        }




        // ======================================================
        // CREATION ALERT
        // ======================================================


        const [alertResult] = await db.query(

            `
            INSERT INTO seller_alerts
            (
                seller_id,
                title,
                message,
                type,
                product_id,
                image_url
            )

            VALUES (?,?,?,?,?,?)

            `,

            [
                sellerId,
                title,
                message,
                type,
                product_id || null,
                imageUrl
            ]

        );



        const alertId = alertResult.insertId;



        // ======================================================
        // RECUPERER LES ABONNES
        // ======================================================


        const [followers] = await db.query(

            `
            SELECT 
                follower_id

            FROM followers

            WHERE user_id=?

            `,

            [
                sellerId
            ]

        );



        let sent = 0;



        // ======================================================
        // ENVOI NOTIFICATION A CHAQUE ABONNE
        // ======================================================


        for(const follower of followers){


            const followerId = follower.follower_id;



            // Sauvegarde notification DB

            await db.query(

                `
                INSERT INTO notifications
                (
                    utilisateur_id,
                    type,
                    destinataire_type,
                    contenu,
                    cible,
                    titre,
                    priorite
                )

                VALUES
                (
                    ?,
                    'seller_alert',
                    'user',
                    ?,
                    ?,
                    ?,
                    'normale'
                )

                `,

                [

                    followerId,

                    message,

                    sellerId,

                    title

                ]

            );





            // TOKEN FCM

            const [tokens] = await db.query(

                `
                SELECT fcm_token
                FROM fcm_tokens
                WHERE user_id=?

                `,

                [
                    followerId
                ]

            );




            if(tokens.length > 0 && tokens[0].fcm_token){



                await sendPushNotification(

                    tokens[0].fcm_token,


                    title,


                    message,


                    {

                        type:"seller_alert",

                        alertId:String(alertId),

                        sellerId:String(sellerId),

                        productId:
                            product_id
                            ?
                            String(product_id)
                            :
                            "",

                        image:imageUrl || ""

                    }


                );


                sent++;


            }


        }





        res.json({

            success:true,

            message:"Alerte envoyée aux abonnés",

            alertId,

            followers: followers.length,

            pushSent:sent

        });



    }catch(error){


        console.error(
            "SELLER ALERT ERROR:",
            error
        );


        res.status(500).json({

            success:false,

            message:"Erreur serveur"

        });


    }

});







// ======================================================
// HISTORIQUE DES ALERTES DU VENDEUR
// GET /api/followers/my-alerts
// ======================================================


router.get("/my-alerts", authMiddleware, async(req,res)=>{


try{


const sellerId=req.userId;



const [alerts]=await db.query(

`
SELECT *

FROM seller_alerts

WHERE seller_id=?

ORDER BY created_at DESC

`,

[
sellerId
]

);



res.json({

success:true,

alerts

});



}catch(error){


console.log(error);


res.status(500).json({

success:false,

message:"Erreur serveur"

});


}


});








// ======================================================
// ALERTES DES BOUTIQUES SUIVIES
// GET /api/followers/alerts
// ======================================================


router.get("/alerts", authMiddleware, async(req,res)=>{


try{


const userId=req.userId;



const [alerts]=await db.query(

`

SELECT

a.*,

u.fullName,
u.profile_photo


FROM seller_alerts a


INNER JOIN followers f

ON f.user_id=a.seller_id



INNER JOIN utilisateurs u

ON u.id=a.seller_id



WHERE f.follower_id=?


ORDER BY a.created_at DESC


`,

[
userId
]

);



res.json({

success:true,

alerts

});



}catch(error){


console.error(error);


res.status(500).json({

success:false,

message:"Erreur serveur"

});


}


});






module.exports = router;


